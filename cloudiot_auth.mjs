// lambda.mjs
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";

const rds_host = process.env.RDS_HOST;
const db_user = process.env.DB_USER;
const db_password = process.env.DB_PASSWORD;
const db_name = process.env.DB_NAME;

const JWT_SECRET = process.env.JWT_SECRET || "changeme-secret";
const JWT_ALGORITHM = "HS256";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event, context) => {
  if (event?.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
    };
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : event;
  } catch {
    body = event;
  }

  const email = body?.email;
  const password_hash = body?.password_hash;

  let conn;
  try {
    conn = await mysql.createConnection({
      host: rds_host,
      user: db_user,
      password: db_password,
      database: db_name,
      connectTimeout: 5000,
    });

    const [rows] = await conn.execute(
      "SELECT user_id, name, email, created_at FROM User WHERE email=? AND password=?",
      [email, password_hash]
    );
    if (rows.length === 0) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: "이메일 또는 비밀번호가 일치하지 않습니다.",
      };
    }
    const { user_id, name, email: user_email, created_at } = rows[0];

    // JWT 토큰 생성 (7일 만료, Python 코드와 맞춤)
    const payload = {
      user_id,
      email: user_email,
      name,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    };
    const token = jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM });

    // DB에 토큰 저장
    await conn.execute("UPDATE User SET jwt_token=? WHERE user_id=?", [
      token,
      user_id,
    ]);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        user: {
          user_id,
          name,
          email: user_email,
          created_at:
            created_at instanceof Date
              ? created_at.toISOString()
              : String(created_at),
        },
        jwt_token: token,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "서버 오류: " + (e?.message || e),
    };
  } finally {
    if (conn) await conn.end();
  }
};
