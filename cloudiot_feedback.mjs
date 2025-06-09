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
  console.log("==== Lambda Event Received ====");
  console.log(JSON.stringify(event, null, 2));

  // 1. Preflight (CORS)
  if (event.httpMethod === "OPTIONS") {
    console.log("Preflight OPTIONS 요청");
    return { statusCode: 200, headers: CORS_HEADERS };
  }

  // 2. JWT 토큰 추출
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  console.log("Headers:", headers);
  console.log("Extracted Authorization Header:", authHeader);

  if (!authHeader) {
    console.log("Authorization header 누락");
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: "Authorization 토큰이 필요합니다.",
    };
  }
  const jwt_token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7)
    : authHeader;

  console.log("Extracted JWT Token:", jwt_token);

  // 3. 요청 파싱 (body 파싱 실패 포함)
  let body;
  try {
    if (event.body && typeof event.body === "string") {
      body = JSON.parse(event.body);
      console.log("Parsed event.body:", body);
    } else {
      body = event.body || event;
      console.log("event.body가 object 또는 없음. body:", body);
    }
  } catch (e) {
    console.log("body 파싱 실패:", e);
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "body 파싱 실패",
    };
  }
  const email = body.email;
  console.log("Parsed email:", email);

  if (!email) {
    console.log("email 누락");
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "email은 필수 입력입니다.",
    };
  }

  let conn;
  try {
    // 4. DB 연결
    console.log("DB 연결 시도 중...");
    conn = await mysql.createConnection({
      host: rds_host,
      user: db_user,
      password: db_password,
      database: db_name,
      connectTimeout: 5000,
    });
    console.log("DB 연결 성공");

    // 5. User 테이블에서 user_id, jwt_token 조회
    const [userRows] = await conn.execute(
      "SELECT user_id, jwt_token FROM User WHERE email=?",
      [email]
    );
    console.log("User 쿼리 결과:", userRows);

    if (!userRows.length) {
      console.log("User not found for email:", email);
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "해당 이메일의 사용자를 찾을 수 없습니다.",
      };
    }
    const { user_id, jwt_token: stored_jwt_token } = userRows[0];

    // 6. JWT 토큰 일치 여부 확인
    if (stored_jwt_token !== jwt_token) {
      console.log(
        `JWT mismatch. stored: ${stored_jwt_token}, given: ${jwt_token}`
      );
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: "유효하지 않은 토큰입니다.",
      };
    }

    // 7. SleepData에서 user_id의 최신 sleep_id 조회
    const [sleepRows] = await conn.execute(
      "SELECT sleep_id FROM SleepData WHERE user_id=? ORDER BY sleep_date DESC LIMIT 1",
      [user_id]
    );
    console.log("SleepData 쿼리 결과:", sleepRows);

    if (!sleepRows.length) {
      console.log("No sleep data for user_id:", user_id);
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "수면 데이터가 없습니다.",
      };
    }
    const sleep_id = sleepRows[0].sleep_id;

    // 8. SleepFeedback에서 해당 sleep_id의 최신 content, created_at 조회
    const [feedbackRows] = await conn.execute(
      "SELECT content, created_at FROM SleepFeedback WHERE sleep_id=? ORDER BY created_at DESC LIMIT 1",
      [sleep_id]
    );
    console.log("SleepFeedback 쿼리 결과:", feedbackRows);

    if (!feedbackRows.length) {
      console.log("No feedback for sleep_id:", sleep_id);
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "피드백 데이터가 없습니다.",
      };
    }
    const { content, created_at } = feedbackRows[0];

    console.log("최종 응답 데이터:", { sleep_id, content, created_at });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        sleep_id,
        content,
        created_at:
          created_at && typeof created_at.toISOString === "function"
            ? created_at.toISOString()
            : String(created_at),
      }),
    };
  } catch (e) {
    console.log("Lambda Error:", e, e.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "서버 오류: " + (e.message || e),
    };
  } finally {
    if (conn) {
      try {
        await conn.end();
        console.log("DB 연결 종료 성공");
      } catch (e) {
        console.log("DB 연결 종료 실패:", e);
      }
    }
  }
};
