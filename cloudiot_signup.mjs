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
  const name = body?.name;

  if (!email || !password_hash || !name) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "이메일, 비밀번호, 이름은 필수 입력 항목입니다.",
    };
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: rds_host,
      user: db_user,
      password: db_password,
      database: db_name,
      connectTimeout: 5000,
    });

    // 이메일 중복 확인
    const [dupRows] = await conn.execute(
      "SELECT user_id FROM User WHERE email=?",
      [email]
    );
    if (dupRows.length > 0) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: "이미 가입된 이메일입니다.",
      };
    }

    // 회원정보 삽입
    const insert_sql = `
      INSERT INTO User (name, email, password, created_at)
      VALUES (?, ?, ?, NOW())
    `;
    await conn.execute(insert_sql, [name, email, password_hash]);
    // 방금 추가한 user_id, created_at 조회
    const [userRows] = await conn.execute(
      "SELECT user_id, created_at FROM User WHERE email=?",
      [email]
    );
    if (!userRows.length) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: "회원가입 처리 중 오류가 발생했습니다.",
      };
    }
    const { user_id, created_at } = userRows[0];

    // JWT 생성 (1주일 유효)
    const payload = {
      user_id,
      email,
      name,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7일 후 만료
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
          email,
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
