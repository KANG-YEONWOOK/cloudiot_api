// lambda.mjs
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

export const handler = async (event, context) => {
  if (event?.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
    };
  }

  // 헤더에서 토큰 추출
  const headers = event?.headers || {};
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

  // POST로 email, year, month 전달
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : event;
  } catch {
    body = event;
  }

  const email = body?.email;
  const year = body?.year;
  const month = body?.month;
  if (!email || !year || !month) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "email, year, month는 필수 입력입니다.",
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

    // 1. User 테이블에서 user_id, jwt_token 조회
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

    // 2. 토큰 검증
    if (stored_jwt_token !== jwt_token) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: "유효하지 않은 토큰입니다.",
      };
    }

    // 3. SleepData에서 해당 연/월 데이터 조회
    const [rows] = await conn.execute(
      `SELECT sleep_date, total_sleep_minutes, sleep_score
       FROM SleepData
       WHERE user_id=? AND YEAR(sleep_date)=? AND MONTH(sleep_date)=?
       ORDER BY sleep_date`,
      [user_id, parseInt(year), parseInt(month)]
    );
    const data = rows.map((row) => ({
      sleep_date: String(row.sleep_date),
      total_sleep_minutes: row.total_sleep_minutes,
      sleep_score: row.sleep_score,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(data),
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
