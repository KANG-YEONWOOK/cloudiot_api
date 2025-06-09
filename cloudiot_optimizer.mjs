import mysql from "mysql2/promise";

const rds_host = process.env.RDS_HOST;
const db_user = process.env.DB_USER;
const db_password = process.env.DB_PASSWORD;
const db_name = process.env.DB_NAME;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS };
  }

  // 1. Authorization 헤더에서 토큰 추출
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  if (!authHeader) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: "Authorization 토큰이 필요합니다.",
    };
  }
  const jwt_token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7)
    : authHeader;

  // 2. 요청 파싱
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : event;
  } catch (e) {
    body = event;
  }
  const email = body.email;

  if (!email) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "email은 필수 입력입니다.",
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

    // 3. email → user_id, jwt_token
    const [userRows] = await conn.execute(
      "SELECT user_id, jwt_token FROM User WHERE email=?",
      [email]
    );
    if (userRows.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "해당 이메일의 사용자를 찾을 수 없습니다.",
      };
    }
    const { user_id, jwt_token: stored_jwt_token } = userRows[0];

    // 4. JWT 토큰 검증
    if (!stored_jwt_token || stored_jwt_token !== jwt_token) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: "유효하지 않은 토큰입니다.",
      };
    }

    // 5. OptimalCondition에서 최신 3개 데이터 조회
    const [optRows] = await conn.execute(
      `SELECT updated_at, target_temperature, target_humidity, description
       FROM OptimalCondition
       WHERE user_id=?
       ORDER BY updated_at DESC
       LIMIT 3`,
      [user_id]
    );

    const result = optRows.map((row) => ({
      updated_at: row.updated_at,
      target_temperature: row.target_temperature,
      target_humidity: row.target_humidity,
      description: row.description,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    if (conn) await conn.end();
  }
};
