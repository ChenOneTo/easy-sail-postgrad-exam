use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager, WindowEvent,
};

// Tauri 命令：退出应用
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// Tauri 命令：隐藏窗口到托盘
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            exit_app,
            hide_to_tray,
        ])
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:easy-sail-postgrad-exam.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            kind: tauri_plugin_sql::MigrationKind::Up,
                            version: 1,
                            description: "create initial schema",
                            sql: r#"
                                -- ===== 任务 =====
                                CREATE TABLE IF NOT EXISTS tasks (
                                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                                    title            TEXT    NOT NULL,
                                    notes            TEXT    DEFAULT '',
                                    project_id       TEXT    DEFAULT 'inbox',
                                    kanban           TEXT    DEFAULT 'todo'
                                        CHECK (kanban IN ('todo','doing','done')),
                                    starred          INTEGER DEFAULT 0,
                                    completed        INTEGER DEFAULT 0,
                                    completed_at     TEXT,
                                    due_date         TEXT,
                                    tags             TEXT    DEFAULT '[]',
                                    sort_order       INTEGER DEFAULT 0,
                                    start_date       TEXT,
                                    reminder_at      TEXT,
                                    reminder_enabled INTEGER DEFAULT 0,
                                    reminder_text    TEXT,
                                    recurrence       TEXT,
                                    snoozed_until    TEXT,
                                    last_notified_at TEXT,
                                    created_at       TEXT    DEFAULT (datetime('now')),
                                    updated_at       TEXT    DEFAULT (datetime('now'))
                                );

                                -- ===== 灵感 =====
                                CREATE TABLE IF NOT EXISTS inspirations (
                                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                                    content    TEXT NOT NULL,
                                    title      TEXT DEFAULT '',
                                    polished   TEXT DEFAULT '',
                                    tags       TEXT DEFAULT '[]',
                                    created_at TEXT DEFAULT (datetime('now')),
                                    updated_at TEXT DEFAULT (datetime('now'))
                                );

                                -- ===== 考研计划 =====
                                CREATE TABLE IF NOT EXISTS exam_profile (
                                    id                INTEGER PRIMARY KEY CHECK (id = 1),
                                    exam_date         TEXT,
                                    target_note       TEXT DEFAULT '',
                                    daily_goal_minutes INTEGER DEFAULT 120,
                                    created_at        TEXT DEFAULT (datetime('now')),
                                    updated_at        TEXT DEFAULT (datetime('now'))
                                );
                                INSERT OR IGNORE INTO exam_profile (id, exam_date) VALUES (1, '2026-12-19');

                                CREATE TABLE IF NOT EXISTS exam_subjects (
                                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                                    key        TEXT UNIQUE NOT NULL,
                                    name       TEXT NOT NULL,
                                    color      TEXT NOT NULL,
                                    sort_order INTEGER DEFAULT 0,
                                    archived   INTEGER DEFAULT 0
                                );
                                INSERT OR IGNORE INTO exam_subjects (key, name, color, sort_order) VALUES
                                    ('english', '英语', '#3B82F6', 0),
                                    ('math', '数学', '#F59E0B', 1),
                                    ('logic', '逻辑', '#8B5CF6', 2);

                                CREATE TABLE IF NOT EXISTS exam_phases (
                                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                                    subject_id INTEGER NOT NULL,
                                    name       TEXT NOT NULL,
                                    start_date TEXT NOT NULL,
                                    end_date   TEXT NOT NULL,
                                    goal       TEXT DEFAULT '',
                                    sort_order INTEGER DEFAULT 0
                                );
                                INSERT OR IGNORE INTO exam_phases (subject_id, name, start_date, end_date, goal, sort_order)
                                  SELECT s.id, p.name, p.sd, p.ed, '', p.ord
                                  FROM exam_subjects s
                                  JOIN (
                                      SELECT '基础' AS name, '2026-01-01' AS sd, '2026-08-31' AS ed, 0 AS ord UNION ALL
                                      SELECT '强化', '2026-09-01', '2026-10-31', 1 UNION ALL
                                      SELECT '冲刺', '2026-11-01', '2026-12-19', 2
                                  ) p;

                                CREATE TABLE IF NOT EXISTS exam_punches (
                                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                                    date        TEXT NOT NULL,
                                    subject_key TEXT NOT NULL,
                                    minutes     INTEGER DEFAULT 0,
                                    note        TEXT DEFAULT '',
                                    created_at  TEXT DEFAULT (datetime('now')),
                                    updated_at  TEXT DEFAULT (datetime('now')),
                                    UNIQUE(date, subject_key)
                                );

                                CREATE TABLE IF NOT EXISTS exam_tasks (
                                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                    subject_key  TEXT NOT NULL,
                                    title        TEXT NOT NULL,
                                    notes        TEXT DEFAULT '',
                                    status       TEXT DEFAULT 'todo'
                                        CHECK (status IN ('todo','doing','done')),
                                    plan_date    TEXT,
                                    started_date TEXT,
                                    completed_at TEXT,
                                    sort_order   INTEGER DEFAULT 0,
                                    created_at   TEXT DEFAULT (datetime('now')),
                                    updated_at   TEXT DEFAULT (datetime('now'))
                                );
                                CREATE INDEX IF NOT EXISTS idx_exam_tasks_subject
                                    ON exam_tasks(subject_key, plan_date);

                                -- ===== 背单词（ts-fsrs）=====
                                -- 词库（静态，可重导；词条由前端首启从 TSV 灌入，迁移不灌词）
                                CREATE TABLE IF NOT EXISTS exam_vocab_words (
                                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                                    word      TEXT NOT NULL,
                                    meaning   TEXT NOT NULL,
                                    unit      TEXT NOT NULL,
                                    seq       INTEGER NOT NULL,
                                    core_zone INTEGER NOT NULL,
                                    archived  INTEGER DEFAULT 0,
                                    UNIQUE(word)
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_words_unit ON exam_vocab_words(unit, seq);
                                CREATE INDEX IF NOT EXISTS idx_vocab_words_zone ON exam_vocab_words(core_zone, archived);

                                -- 调度状态（一词一卡，可双向）
                                CREATE TABLE IF NOT EXISTS exam_vocab_cards (
                                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                                    word_id          INTEGER NOT NULL,
                                    direction        TEXT NOT NULL DEFAULT 'en2zh'
                                        CHECK (direction IN ('en2zh','zh2en')),
                                    state            TEXT NOT NULL DEFAULT 'new'
                                        CHECK (state IN ('new','learning','review','relearning')),
                                    step_idx         INTEGER DEFAULT 0,
                                    due              TEXT,
                                    stability        REAL DEFAULT 0,
                                    difficulty       REAL DEFAULT 0,
                                    reps             INTEGER DEFAULT 0,
                                    lapses           INTEGER DEFAULT 0,
                                    last_reviewed_at TEXT,
                                    created_at       TEXT DEFAULT (datetime('now')),
                                    updated_at       TEXT DEFAULT (datetime('now')),
                                    UNIQUE(word_id, direction)
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_cards_due   ON exam_vocab_cards(state, due);
                                CREATE INDEX IF NOT EXISTS idx_vocab_cards_state ON exam_vocab_cards(state);

                                -- 复习日志（统计曲线用）
                                CREATE TABLE IF NOT EXISTS exam_vocab_reviews (
                                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                                    card_id       INTEGER NOT NULL,
                                    word_id       INTEGER NOT NULL,
                                    rating        INTEGER NOT NULL,
                                    state_before  TEXT NOT NULL,
                                    interval_days REAL DEFAULT 0,
                                    duration_ms   INTEGER DEFAULT 0,
                                    reviewed_at   TEXT DEFAULT (datetime('now'))
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_rev_day  ON exam_vocab_reviews(reviewed_at);
                                CREATE INDEX IF NOT EXISTS idx_vocab_rev_card ON exam_vocab_reviews(card_id, reviewed_at);

                                -- 难词本
                                CREATE TABLE IF NOT EXISTS exam_vocab_hardwords (
                                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                    word_id      INTEGER NOT NULL,
                                    reason       TEXT DEFAULT '',
                                    again_streak INTEGER DEFAULT 0,
                                    note         TEXT DEFAULT '',
                                    status       TEXT DEFAULT 'new' CHECK (status IN ('new','grasped')),
                                    added_at     TEXT DEFAULT (datetime('now')),
                                    updated_at   TEXT DEFAULT (datetime('now')),
                                    UNIQUE(word_id)
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_hard_status ON exam_vocab_hardwords(status);

                                -- 全局配置（单例行）
                                CREATE TABLE IF NOT EXISTS exam_vocab_profile (
                                    id                  INTEGER PRIMARY KEY CHECK (id = 1),
                                    card_direction      TEXT DEFAULT 'en2zh' CHECK (card_direction IN ('en2zh','zh2en','both')),
                                    target_retention    REAL DEFAULT 0.9,
                                    max_reviews_per_day INTEGER DEFAULT 200,
                                    phase1_start        TEXT DEFAULT '2026-09-06',
                                    phase1_end          TEXT DEFAULT '2026-10-26',
                                    phase1_new_per_day  INTEGER DEFAULT 50,
                                    phase2_start        TEXT DEFAULT '2026-10-27',
                                    phase2_end          TEXT DEFAULT '2026-12-02',
                                    phase2_new_per_day  INTEGER DEFAULT 70,
                                    phase3_start        TEXT DEFAULT '2026-12-03',
                                    phase3_end          TEXT DEFAULT '2026-12-18',
                                    phase3_new_per_day  INTEGER DEFAULT 0,
                                    last_study_date     TEXT,
                                    streak              INTEGER DEFAULT 0,
                                    created_at          TEXT DEFAULT (datetime('now')),
                                    updated_at          TEXT DEFAULT (datetime('now'))
                                );
                                INSERT OR IGNORE INTO exam_vocab_profile (id) VALUES (1);

                                -- AI 助记（词根拆解 + 口诀 + 例句）。AI 生成后持久化，重新打开不再重复生成。
                                CREATE TABLE IF NOT EXISTS exam_vocab_mnemonics (
                                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                                    word_id     INTEGER NOT NULL,
                                    roots       TEXT DEFAULT '',
                                    mnemonic    TEXT DEFAULT '',
                                    sentence    TEXT DEFAULT '',
                                    sentence_zh TEXT DEFAULT '',
                                    method      TEXT DEFAULT '',
                                    scene       TEXT DEFAULT '',
                                    created_at  TEXT DEFAULT (datetime('now')),
                                    updated_at  TEXT DEFAULT (datetime('now')),
                                    UNIQUE(word_id)
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_mnemonic_word ON exam_vocab_mnemonics(word_id);

                                -- 单词闯关成绩：每完成一关记一行。passed=1 的词数累计即关卡推进量，
                                -- 与 FSRS 卡片/复习日志共用词库，不重复存单词。replay=1 表示重闯已通关卡。
                                CREATE TABLE IF NOT EXISTS exam_vocab_game_runs (
                                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                                    level       INTEGER NOT NULL,
                                    level_size  INTEGER NOT NULL DEFAULT 20,
                                    words_total INTEGER NOT NULL DEFAULT 0,
                                    correct     INTEGER NOT NULL DEFAULT 0,
                                    answered    INTEGER NOT NULL DEFAULT 0,
                                    accuracy    REAL    NOT NULL DEFAULT 0,
                                    duration_ms INTEGER NOT NULL DEFAULT 0,
                                    passed      INTEGER NOT NULL DEFAULT 0,
                                    replay      INTEGER NOT NULL DEFAULT 0,
                                    started_at  TEXT DEFAULT (datetime('now')),
                                    finished_at TEXT DEFAULT (datetime('now'))
                                );
                                CREATE INDEX IF NOT EXISTS idx_vocab_game_level  ON exam_vocab_game_runs(level);
                                CREATE INDEX IF NOT EXISTS idx_vocab_game_finish ON exam_vocab_game_runs(finished_at);
                                CREATE INDEX IF NOT EXISTS idx_vocab_game_replay ON exam_vocab_game_runs(replay);
                            "#,
                        },
                        tauri_plugin_sql::Migration {
                            kind: tauri_plugin_sql::MigrationKind::Up,
                            version: 2,
                            description: "drop inspirations table (feature removed)",
                            sql: r#"
                                DROP TABLE IF EXISTS inspirations;
                            "#,
                        },
                        tauri_plugin_sql::Migration {
                            kind: tauri_plugin_sql::MigrationKind::Up,
                            version: 3,
                            description: "add english reading practice tables",
                            sql: r#"
                                -- ===== 阅读文章 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_passages (
                                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                    passage_key  TEXT UNIQUE NOT NULL,
                                    year         INTEGER NOT NULL,
                                    text_no      INTEGER NOT NULL,
                                    title        TEXT DEFAULT '',
                                    topic        TEXT DEFAULT '',
                                    difficulty   INTEGER DEFAULT 2,
                                    word_count   INTEGER DEFAULT 0,
                                    content      TEXT NOT NULL,
                                    translation  TEXT DEFAULT '[]',
                                    source_ref   TEXT DEFAULT '',
                                    archived     INTEGER DEFAULT 0,
                                    created_at   TEXT DEFAULT (datetime('now')),
                                    updated_at   TEXT DEFAULT (datetime('now')),
                                    UNIQUE(year, text_no)
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_passage_year
                                    ON exam_reading_passages(year, text_no, archived);

                                -- ===== 题目 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_questions (
                                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                    question_key TEXT UNIQUE NOT NULL,
                                    passage_id   INTEGER NOT NULL,
                                    seq          INTEGER NOT NULL,
                                    stem         TEXT NOT NULL,
                                    options      TEXT NOT NULL DEFAULT '[]',
                                    answer       TEXT NOT NULL CHECK (answer IN ('A','B','C','D')),
                                    answer_alt   TEXT DEFAULT ''
                                                 CHECK (answer_alt IN ('','A','B','C','D')),
                                    disputed     INTEGER DEFAULT 0 CHECK (disputed IN (0,1)),
                                    qtype        TEXT DEFAULT 'detail'
                                                 CHECK (qtype IN ('detail','infer','main','vocab','attitude','example','other')),
                                    locate_para  INTEGER DEFAULT 0,
                                    locate_hint  TEXT DEFAULT '',
                                    explanation  TEXT DEFAULT '',
                                    distractors  TEXT DEFAULT '',
                                    answer_note  TEXT DEFAULT '',
                                    source_ref   TEXT DEFAULT '',
                                    difficulty   INTEGER DEFAULT 2,
                                    archived     INTEGER DEFAULT 0,
                                    UNIQUE(passage_id, seq),
                                    CHECK (answer_alt = '' OR answer_alt <> answer),
                                    CHECK (disputed = 0 OR answer_alt <> '')
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_q_passage
                                    ON exam_reading_questions(passage_id, seq, archived);
                                CREATE INDEX IF NOT EXISTS idx_reading_q_type
                                    ON exam_reading_questions(qtype);

                                -- ===== 练习会话 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_sessions (
                                    id             TEXT PRIMARY KEY,
                                    mode           TEXT NOT NULL CHECK (mode IN ('close','timed','set','wrong')),
                                    scope          TEXT NOT NULL,
                                    limit_seconds  INTEGER DEFAULT 0,
                                    started_at     TEXT NOT NULL,
                                    deadline_at    TEXT,
                                    submitted_at   TEXT,
                                    elapsed_ms     INTEGER DEFAULT 0,
                                    question_count INTEGER DEFAULT 0,
                                    answered_count INTEGER DEFAULT 0,
                                    correct_count  INTEGER DEFAULT 0,
                                    score          INTEGER DEFAULT 0,
                                    overtime       INTEGER DEFAULT 0,
                                    in_exam_slot   INTEGER DEFAULT 0,
                                    status         TEXT DEFAULT 'ongoing'
                                                   CHECK (status IN ('ongoing','submitted','abandoned')),
                                    created_at     TEXT DEFAULT (datetime('now'))
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_session_status
                                    ON exam_reading_sessions(status, started_at);
                                CREATE INDEX IF NOT EXISTS idx_reading_session_scope
                                    ON exam_reading_sessions(scope, mode);

                                -- ===== 会话题目 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_session_questions (
                                    session_id  TEXT NOT NULL,
                                    question_id INTEGER NOT NULL,
                                    sort_order  INTEGER DEFAULT 0,
                                    PRIMARY KEY (session_id, question_id)
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_sq_session
                                    ON exam_reading_session_questions(session_id, sort_order);

                                -- ===== 作答明细 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_attempts (
                                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                                    session_id  TEXT NOT NULL,
                                    question_id INTEGER NOT NULL,
                                    user_answer TEXT DEFAULT '',
                                    is_correct  INTEGER DEFAULT 0,
                                    duration_ms INTEGER DEFAULT 0,
                                    flagged     INTEGER DEFAULT 0,
                                    answered_at TEXT DEFAULT (datetime('now')),
                                    UNIQUE(session_id, question_id)
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_attempt_session
                                    ON exam_reading_attempts(session_id);
                                CREATE INDEX IF NOT EXISTS idx_reading_attempt_question
                                    ON exam_reading_attempts(question_id, answered_at);

                                -- ===== 错题本 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_wrongbook (
                                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                                    question_id       INTEGER NOT NULL UNIQUE,
                                    wrong_count       INTEGER DEFAULT 1,
                                    last_wrong_answer TEXT DEFAULT '',
                                    reason            TEXT DEFAULT '',
                                    note              TEXT DEFAULT '',
                                    status            TEXT DEFAULT 'new' CHECK (status IN ('new','grasped')),
                                    correct_streak    INTEGER DEFAULT 0,
                                    last_reviewed_at  TEXT,
                                    added_at          TEXT DEFAULT (datetime('now')),
                                    updated_at        TEXT DEFAULT (datetime('now'))
                                );
                                CREATE INDEX IF NOT EXISTS idx_reading_wrong_status
                                    ON exam_reading_wrongbook(status, added_at);

                                -- ===== 配置 =====
                                CREATE TABLE IF NOT EXISTS exam_reading_profile (
                                    id                INTEGER PRIMARY KEY CHECK (id = 1),
                                    close_seconds     INTEGER DEFAULT 0,
                                    timed_seconds     INTEGER DEFAULT 1080,
                                    set_seconds       INTEGER DEFAULT 4200,
                                    exam_slot_start   TEXT DEFAULT '14:00',
                                    exam_slot_end     TEXT DEFAULT '17:00',
                                    slot_hint         INTEGER DEFAULT 1,
                                    mock_years        TEXT DEFAULT '[]',
                                    bank_version      INTEGER DEFAULT 0,
                                    updated_at        TEXT DEFAULT (datetime('now'))
                                );
                                INSERT OR IGNORE INTO exam_reading_profile (id) VALUES (1);
                            "#,
                        },
                    ],
                )
                .build(),
        )
        .setup(|app| {
            // 创建托盘菜单
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // 配置托盘图标事件
            let tray = app.tray_by_id("main").expect("tray not found");
            tray.set_menu(Some(menu))?;
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            });
            tray.on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            window.set_focus().unwrap();
                        } else {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 点击关闭按钮直接隐藏到托盘，无需用户选择
                api.prevent_close();
                if let Some(win) = window.app_handle().get_webview_window("main") {
                    let _ = win.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
