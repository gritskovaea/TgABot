CREATE TABLE users (
                       id BIGINT PRIMARY KEY,
                       username TEXT,
                       first_name TEXT,
                       last_name TEXT
);

CREATE TABLE messages (
                          id BIGSERIAL PRIMARY KEY,
                          user_id BIGINT REFERENCES users(id),
                          chat_id BIGINT,
                          text TEXT,
                          created_at TIMESTAMP DEFAULT now()
);