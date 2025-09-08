// server.js
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const fs = require('fs');
const cron = require('node-cron');
const moment = require('moment');
const sqlite3 = require("sqlite3").verbose();
let db = new sqlite3.Database("/usr/src/app/newstartDB/database.db");
let backupDir="/usr/src/app/newstartDB/";
// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept",
    );
    next();
});
app.use((err, req, res, next) => {
    console.error("Server error:", {
        url: req.originalUrl,
        method: req.method,
        body: req.body,
        error: err.stack,
    });
    res.status(500).json({ error: "حدث خطأ في الخادم" });
});

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
const uploadsDir = path.join( "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));
// تعيين محرك العرض
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "html");
db.serialize(() => {
    // جدول المشتركين
   db.run(`CREATE TABLE IF NOT EXISTS subscribers (
    subscriber_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    subscription_type TEXT NOT NULL,
    meals_deducted INTEGER DEFAULT 0,
    meals_remaining INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT DEFAULT 'System'
)`);
    // جدول سجل الوجبات
    db.run(`CREATE TABLE IF NOT EXISTS meal_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      subscriber_id INTEGER NOT NULL,
      subscriber_name TEXT NOT NULL,
      subscription_type TEXT NOT NULL,
      meals_deducted INTEGER NOT NULL,
      meals_remaining INTEGER NOT NULL,
      user TEXT NOT NULL,
      FOREIGN KEY (subscriber_id) REFERENCES subscribers(subscriber_id)
  )`);

    // جدول قائمة الطعام
    db.run(`CREATE TABLE IF NOT EXISTS menu (
      item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      price REAL NOT NULL
  )`);

    // جدول الباقات
    db.run(`CREATE TABLE IF NOT EXISTS packages (
      package_id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      price REAL NOT NULL,
      meals_count INTEGER NOT NULL,
      subscription_days INTEGER NOT NULL
  )`);

    // جدول طلبات الاشتراك
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      order_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      subscription_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'قيد الانتظار'
  )`);

    // جدول المستخدمين
    db.run(`CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
  )`);
});
db.run(`CREATE TABLE IF NOT EXISTS logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT
)`);
// إضافة مستخدم افتراضي
db.run(
    `INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)`,
    ["admin", "admin123"],
    (err) => {
        if (err) {
            console.error("Error creating default user:", err);
        }
    },
);
// Routes
app.get("/newstart", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});
app.get("/newstart/qrcode", (req, res) => {
    res.sendFile(path.join(__dirname, "qrcode.html"));
});
app.get("/newstart/index", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/newstart/qrscaner", (req, res) => {
    res.sendFile(path.join(__dirname, "qrscaner.html"));
});
// API Routes
// المشتركين
app.get("/newstart/api/subscribers", (req, res) => {
    const search = req.query.search || "";
    db.all(
        `SELECT * FROM subscribers 
         WHERE name LIKE ? OR phone LIKE ?`,
        [`%${search}%`, `%${search}%`],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        },
    );
});

// ✅ إضافة مشترك
app.post("/newstart/api/subscribers", (req, res) => {
    const {
        name,
        phone,
        start_date,
        end_date,
        subscription_type,
        meals_remaining,
        status,
        actionUser
    } = req.body;

    const created_at = new Date().toISOString(); // تاريخ الإضافة الحالي

    db.run(
        `INSERT INTO subscribers 
        (name, phone, start_date, end_date, subscription_type, 
         meals_remaining, status, created_at, created_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            name,
            phone,
            start_date,
            end_date,
            subscription_type,
            meals_remaining || 0,
            status,
            created_at,
            actionUser || 'System'
        ],
        function (err) {
            if (err) {
                console.error("Error adding subscriber:", err);
                return res.status(500).json({ error: err.message });
            }

            // ✅ سجل العملية
            addLog(actionUser, "إضافة مشترك", `تمت إضافة المشترك ${name} (${phone})`);

            res.json({
                success: true,
                subscriber_id: this.lastID,
            });
        }
    );
});

// قائمة الطعام
app.get("/newstart/api/menu", (req, res) => {
    db.all("SELECT * FROM menu", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.post("/newstart/api/menu", (req, res) => {
    const { item_name, price, username = "System" } = req.body;
    db.run(
        "INSERT INTO menu (item_name, price) VALUES (?, ?)",
        [item_name, price],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            addLog(username, "إضافة قائمة طعام", `تمت إضافة ${item_name} بسعر ${price}`);

            res.json({ id: this.lastID });
        },
    );
});

// الباقات
app.get("/newstart/api/packages", (req, res) => {
    const search = req.query.search || "";
    db.all(
        `SELECT * FROM packages WHERE package_name LIKE ?`,
        [`%${search}%`],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        },
    );
});

app.post("/newstart/api/packages", (req, res) => {
    const { package_name, price, meals_count, subscription_days, actionUser } = req.body;
    db.run(
        `INSERT INTO packages (package_name, price, meals_count, subscription_days) 
         VALUES (?, ?, ?, ?)`,
        [package_name, price, meals_count, subscription_days],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            addLog(actionUser, "إضافة باقة", `تمت إضافة باقة ${package_name}`);

            res.json({ id: this.lastID });
        },
    );
});

// طلبات الاشتراك
app.get("/newstart/api/orders", (req, res) => {
    db.all(
        "SELECT * FROM orders WHERE status = ?",
        ["قيد الانتظار"],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        },
    );
});

app.post("/newstart/api/orders/approve", (req, res) => {
    const { order_id } = req.body;
    // هنا يمكنك إضافة منطق الموافقة على الطلب
    // مثل إنشاء مشترك جديد بناءً على الطلب
    res.json({ success: true });
});

// الإحصائيات
app.get("/newstart/api/stats", (req, res) => {
    db.get("SELECT COUNT(*) as total FROM subscribers", (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const totalSubscribers = row.total;

        db.get(
            "SELECT COUNT(*) as active FROM subscribers WHERE status = ?",
            ["نشط"],
            (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const activeSubscribers = row.active;

                db.get(
                    `SELECT subscription_type as popular FROM subscribers 
                   GROUP BY subscription_type ORDER BY COUNT(*) DESC LIMIT 1`,
                    (err, row) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }
                        const popularPackage = row
                            ? row.popular
                            : "لا يوجد بيانات";

                        res.json({
                            totalSubscribers,
                            activeSubscribers,
                            popularPackage,
                        });
                    },
                );
            },
        );
    });
});
// الحصول على الباقات لاستخدامها في واجهة إضافة المشترك
app.get("/newstart/api/packages/list", (req, res) => {
    db.all("SELECT * FROM packages", (err, rows) => {
        if (err) {
            console.error("Database error:", err); // إضافة تسجيل للخطأ
            res.status(500).json({ error: err.message });
            return;
        }
        console.log("Packages sent:", rows); // تسجيل البيانات المرسلة
        res.json(rows);
    });
});
// ✅ تعديل مشترك
app.put("/newstart/api/subscribers/:id", (req, res) => {
    const {
        name,
        phone,
        start_date,
        end_date,
        subscription_type,
        meals_remaining,
        status,
        actionUser
    } = req.body;

    // أولاً: جلب البيانات القديمة قبل التعديل
    db.get(
        "SELECT * FROM subscribers WHERE subscriber_id = ?",
        [req.params.id],
        (err, oldData) => {
            if (err) {
                console.error("Error fetching old subscriber data:", err);
                return res.status(500).json({ error: err.message });
            }

            if (!oldData) {
                return res.status(404).json({ error: "المشترك غير موجود" });
            }

            // ثانياً: تحديث البيانات
            db.run(
                `UPDATE subscribers SET 
                 name = ?, 
                 phone = ?, 
                 start_date = ?, 
                 end_date = ?, 
                 subscription_type = ?, 
                 meals_remaining = ?, 
                 status = ? 
                 WHERE subscriber_id = ?`,
                [
                    name,
                    phone,
                    start_date,
                    end_date,
                    subscription_type,
                    meals_remaining,
                    status,
                    req.params.id,
                ],
                function (err) {
                    if (err) {
                        console.error("Error updating subscriber:", err);
                        return res.status(500).json({ error: err.message });
                    }

                   if (this.changes > 0) {
    // ثالثاً: مقارنة البيانات القديمة بالجديدة وبناء تفاصيل التعديل
    const changes = [];

    if (oldData.name !== name) {
        changes.push(`تم تغيير الاسم من "${oldData.name}" إلى "${name}"`);
    }
    if (oldData.phone !== phone) {
        changes.push(`تم تغيير رقم الجوال من "${oldData.phone}" إلى "${phone}"`);
    }
    if (oldData.start_date !== start_date) {
        changes.push(`تم تغيير تاريخ البدء من "${oldData.start_date}" إلى "${start_date}"`);
    }
    if (oldData.end_date !== end_date) {
        changes.push(`تم تغيير تاريخ الانتهاء من "${oldData.end_date}" إلى "${end_date}"`);
    }
    if (oldData.subscription_type !== subscription_type) {
        changes.push(`تم تغيير نوع الاشتراك من "${oldData.subscription_type}" إلى "${subscription_type}"`);
    }
    if (oldData.meals_remaining !== meals_remaining) {
        changes.push(`تم تغيير الوجبات المتبقية من "${oldData.meals_remaining}" إلى "${meals_remaining}"`);
    }
    if (oldData.status !== status) {
        changes.push(`تم تغيير الحالة من "${oldData.status}" إلى "${status}"`);
    }

    // بناء رسالة التفاصيل
    let details = `تم تعديل بيانات المشترك ${oldData.name} (${oldData.phone}).`;
    if (changes.length > 0) {
        details += `\nالتغييرات:\n- ${changes.join('\n- ')}`;
    } else {
        details += `\n(لم يتم إجراء أي تغييرات فعلية)`;
    }

    // تسجيل التفاصيل في السجل
    addLog(actionUser, "تعديل مشترك", details);
}

                    res.json({
                        success: true,
                        changes: this.changes,
                    });
                }
            );
        }
    );
});

// الحصول على بيانات مشترك معين
app.get("/newstart/api/subscribers/:id", (req, res) => {
    db.get(
        "SELECT * FROM subscribers WHERE subscriber_id = ?",
        [req.params.id],
        (err, row) => {
            if (err) {
                console.error("Error fetching subscriber:", err);
                res.status(500).json({ error: err.message });
                return;
            }
            if (!row) {
                res.status(404).json({ error: "المشترك غير موجود" });
                return;
            }
            res.json(row);
        },
    );
});
app.delete("/newstart/api/subscribers/:id", (req, res) => {
    const username = req.body.actionUser || "System";

    db.get("SELECT name FROM subscribers WHERE subscriber_id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(
            "DELETE FROM subscribers WHERE subscriber_id = ?",
            [req.params.id],
            function (err) {
                if (err) {
                    console.error("Error deleting subscriber:", err);
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: "المشترك غير موجود" });
                }

                addLog(username, "حذف مشترك", `تم حذف المشترك ${row?.name || req.params.id}`);

                res.json({ success: true, changes: this.changes });
            },
        );
    });
});
app.post("/newstart/api/subscribers/:id/deduct-meal", (req, res) => {
    // الحصول على اسم المستخدم من الجسم أو من بيانات الجلسة
   const username = req.body.actionUser;
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. التحقق من وجود وجبات متبقية
        db.get(
            "SELECT meals_remaining FROM subscribers WHERE subscriber_id = ?",
            [req.params.id],
            (err, row) => {
                if (err) {
                    db.run("ROLLBACK");
                    console.error("Error checking meals:", err);
                    return res.status(500).json({ error: err.message });
                }

                if (!row || row.meals_remaining <= 0) {
                    db.run("ROLLBACK");
                    return res
                        .status(400)
                        .json({ error: "لا توجد وجبات متبقية لهذا المشترك" });
                }

                // 2. خصم وجبة
                db.run(
                    "UPDATE subscribers SET meals_remaining = meals_remaining - 1 WHERE subscriber_id = ?",
                    [req.params.id],
                    function (err) {
                        if (err) {
                            db.run("ROLLBACK");
                            console.error("Error deducting meal:", err);
                            return res.status(500).json({ error: err.message });
                        }

                        // 3. تسجيل العملية في سجل الوجبات
                        const logData = {
                            date: new Date().toISOString(),
                            subscriber_id: req.params.id,
                            subscriber_name: req.body.subscriber_name,
                            subscription_type: req.body.subscription_type,
                            meals_deducted: 1,
                            meals_remaining: row.meals_remaining - 1,
                            user: username, // استخدام اسم المستخدم الفعلي هنا
                        };

                        db.run(
                            `INSERT INTO meal_logs (date, subscriber_id, subscriber_name, subscription_type, meals_deducted, meals_remaining, user) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            Object.values(logData),
                            function (err) {
                                if (err) {
                                    db.run("ROLLBACK");
                                    console.error(
                                        "Error logging meal deduction:",
                                        err,
                                    );
                                    return res
                                        .status(500)
                                        .json({ error: err.message });
                                }
                                addLog(username, "خصم وجبة", `تم خصم وجبة من المشترك ${req.body.subscriber_name}.`);
                                db.run("COMMIT");
                                res.json({
                                    success: true,
                                    meals_remaining: logData.meals_remaining,
                                    log_id: this.lastID,
                                });
                            },
                        );
                    },
                );
            },
        );
    });
});
app.get("/newstart/api/packages/:id", (req, res) => {
    db.get(
        "SELECT * FROM packages WHERE package_id = ?",
        [req.params.id],
        (err, row) => {
            if (err) {
                console.error("Error fetching package:", err);
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: "الباقة غير موجودة" });
            }
            res.json(row);
        },
    );
});

// تحديث باقة
app.put("/newstart/api/packages/:id", (req, res) => {
    const { package_name, price, meals_count, subscription_days, actionUser } = req.body;

    db.run(
        `UPDATE packages SET 
         package_name = ?, 
         price = ?, 
         meals_count = ?, 
         subscription_days = ? 
         WHERE package_id = ?`,
        [package_name, price, meals_count, subscription_days, req.params.id],
        function (err) {
            if (err) {
                console.error("Error updating package:", err);
                return res.status(500).json({ error: err.message });
            }
            res.json({
                success: true,
                changes: this.changes,
            });
            addLog(actionUser, "تعديل باقة", `تم تعديل الباقة ${package_name || req.params.id}`);
        },
    );
});

// حذف باقة
// ✅ حذف باقة
app.delete("/newstart/api/packages/:id", (req, res) => {
    const username = req.body.actionUser ;
    db.get("SELECT package_name FROM packages WHERE package_id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(
            "DELETE FROM packages WHERE package_id = ?",
            [req.params.id],
            function (err) {
                if (err) {
                    console.error("Error deleting package:", err);
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes > 0) {
                    addLog(username, "حذف باقة", `تم حذف الباقة ${row?.package_name || req.params.id}`);
                }
                res.json({ success: true, changes: this.changes });
            },
        );
    });
});
app.get("/newstart/api/subscribers/:id/report", (req, res) => {
    const subscriberId = req.params.id;
    
    // جلب بيانات المشترك الأساسية
    db.get("SELECT * FROM subscribers WHERE subscriber_id = ?", [subscriberId], (err, subscriber) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!subscriber) {
            return res.status(404).json({ error: "المشترك غير موجود" });
        }
        
        // جلب سجل الوجبات للمشترك
        db.all("SELECT * FROM meal_logs WHERE subscriber_id = ? ORDER BY date DESC", [subscriberId], (err, mealLogs) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // جلب إجمالي الوجبات المخصومة
            db.get("SELECT SUM(meals_deducted) AS total_deducted FROM meal_logs WHERE subscriber_id = ?", [subscriberId], (err, total) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                res.json({
                    subscriber,
                    mealLogs: mealLogs || [],
                    totalDeducted: total.total_deducted || 0,
                    mealsRemaining: subscriber.meals_remaining
                });
            });
        });
    });
});
app.post('/newstart/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'اسم المستخدم وكلمة المرور مطلوبان' 
        });
    }
    
    // البحث عن المستخدم في قاعدة البيانات
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'خطأ في الخادم' 
            });
        }
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'اسم المستخدم غير صحيح' 
            });
        }
        
        // التحقق من كلمة المرور
        if (user.password !== password) {
            return res.status(401).json({ 
                success: false, 
                message: 'كلمة المرور غير صحيحة' 
            });
        }
            addLog(username, "تسجيل دخول", "تم تسجيل الدخول بنجاح");
        // عند نجاح عملية الدخول
        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح',
            user: {
                user_id: user.user_id,
                username: user.username,
                role: user.role || 'مدير النظام'
            }
        });
    });
});
app.get('/newstart/api/users', (req, res) => {
  const search = (req.query.search || '').trim();

  let sql = `SELECT user_id, username FROM users`;
  let params = [];

  // إذا فيه كلمة بحث، نبحث باليوزرنيم وبـ user_id (كنص)
  if (search !== '') {
    sql += ` WHERE username LIKE ? OR CAST(user_id AS TEXT) LIKE ?`;
    const like = `%${search}%`;
    params = [like, like];
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
    res.json(rows);
  });
});
// إضافة مستخدم جديد
app.post('/newstart/api/users', (req, res) => {
    const { username, password, actionUser } = req.body; // 👈 المستخدم الحالي
    
    if (!username || !password) {
        return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }
    
    db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, password],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
                }
                console.error('Database error:', err);
                return res.status(500).json({ error: 'خطأ في الخادم' });
            }

            // 👇 هنا نسجل العملية باسم اللي قام بالفعل
            addLog(actionUser || "System", "إضافة مستخدم", `تمت إضافة المستخدم ${username}`);
            
            res.json({
                success: true,
                user_id: this.lastID
            });
        }
    );
});

// تحديث مستخدم
app.put('/newstart/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const { username, password, actionUser } = req.body;

    if (!username) {
        return res.status(400).json({ error: 'اسم المستخدم ' });
    }
    
    let query = 'UPDATE users SET username = ?';
    let params = [username];
    
    if (password) {
        query += ', password = ?';
        params.push(password);
    }
    
    query += ' WHERE user_id = ?';
    params.push(userId);
    addLog(actionUser , "تعديل مستخدم", `تمت تعديل المستخدم ${username}`);
    db.run(query, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
            }
            console.error('Database error:', err);
            return res.status(500).json({ error: 'خطأ في الخادم' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        res.json({ success: true });
    });
});

// حذف مستخدم
app.delete('/newstart/api/users/:id', (req, res) => {
    const actionUser = req.body.actionUser || "System";

    db.get("SELECT username FROM users WHERE user_id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run('DELETE FROM users WHERE user_id = ?', [req.params.id], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'خطأ في الخادم' });
            }
            
            if (this.changes > 0) {
                addLog(actionUser, "حذف مستخدم", `تم حذف المستخدم ${row?.username || req.params.id}`);
            }
            
            res.json({ success: true });
        });
    });
});

// جلب بيانات مستخدم معين
app.get('/newstart/api/users/:id', (req, res) => {
    const userId = req.params.id;
    
    db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'خطأ في الخادم' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        // لا نرسل كلمة المرور في الاستجابة
        const { password, ...userData } = row;
        res.json(userData);
    });
});
app.post("/newstart/api/send-message", async (req, res) => {
  const { number, message, id } = req.body;
  let filePath;

  try {
    // التحقق من وجود البيانات المطلوبة
    if (!number || !message || !id) {
      return res.status(400).json({ 
        success: false, 
        error: "بيانات غير مكتملة: رقم الهاتف، الرسالة، وبيانات المشترك مطلوبة" 
      });
    }

    // إنشاء QR Code من بيانات المشترك
    const qrData = JSON.stringify(id);
    const fileName = `qrcode_${number}_${Date.now()}.png`;
    filePath = path.join(uploadsDir, fileName);

    console.log(`محاولة إنشاء QR Code في: ${filePath}`);

    // استخدام options لتحسين إنشاء QR Code
    const qrOptions = {
      errorCorrectionLevel: 'H',
      type: 'png',
      quality: 0.9,
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    };

    // حفظ QR Code في مجلد uploads
    try {
      await QRCode.toFile(filePath, qrData, qrOptions);
      console.log("تم إنشاء QR Code بنجاح");
      
      // التحقق من وجود الملف بعد إنشائه
      if (fs.existsSync(filePath)) {
        console.log("تم التحقق من وجود ملف QR Code بنجاح");
        const stats = fs.statSync(filePath);
        console.log(`حجم الملف: ${stats.size} bytes`);
      } else {
        throw new Error("لم يتم إنشاء ملف QR Code");
      }
    } catch (qrError) {
      console.error("خطأ في إنشاء QR Code:", qrError);
      throw new Error("فشل في إنشاء QR Code: " + qrError.message);
    }

    // إرسال الصورة مع النص عبر API الخاص بك
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
    console.log(`محاولة إرسال الصورة عبر الرابط: ${imageUrl}`);
    
    const response = await fetch(`https://resturantgateway-production.up.railway.app/send-image?number=${number}&image=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(message)}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("فشل في إرسال الرسالة إلى الخدمة الخارجية:", errorText);
      throw new Error("فشل في إرسال الرسالة إلى الخدمة الخارجية: " + errorText);
    }

    res.json({ 
      success: true, 
      message: "تم إرسال رسالة واتساب بنجاح مع QR Code",
      qrCodePath: `/uploads/${fileName}`
    });

  } catch (err) {
    console.error("خطأ أثناء إرسال الرسالة:", err);
    
    // حذف الصورة إذا فشل الإرسال
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log("تم حذف ملف QR Code بسبب فشل الإرسال");
      } catch (unlinkError) {
        console.error("خطأ أثناء حذف الملف:", unlinkError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: err.message || "فشل في إرسال الرسالة" 
    });
  }
});
function createBackup() {
    const backupName = `backup-${moment().format('YYYY-MM-DD_HH-mm-ss')}.db`;
    const backupPath = path.join("/usr/src/app/newstartDB/", backupName);
    const currentDbPath = "/usr/src/app/newstartDB/database.db";
    if (fs.existsSync(currentDbPath)) {
        fs.copyFileSync(currentDbPath, backupPath);
        console.log(`تم إنشاء نسخة احتياطية: ${backupPath}`);
    } else {
        console.log('قاعدة البيانات غير موجودة، لم يتم إنشاء نسخة احتياطية.');
    }

    return backupPath;
}

// جدولة النسخة اليومية الساعة 12 بالليل
cron.schedule('0 0 * * *', () => {
    console.log('جاري إنشاء نسخة احتياطية يومية...');
    createBackup();
});

// مسار لإنشاء نسخة احتياطية يدوية
app.get('/newstart/api/backup', (req, res) => {
    try {
        const backupPath = createBackup();
        res.json({
            success: true,
            message: 'تم إنشاء النسخة الاحتياطية بنجاح',
            backupPath: path.basename(backupPath)
        });
    } catch (err) {
        console.error('خطأ في النسخ الاحتياطي:', err);
        res.status(500).json({ success: false, message: 'فشل في إنشاء النسخة الاحتياطية' });
    }
});

// مسار لسرد النسخ الاحتياطية المتاحة
app.get('/newstart/api/backups', (req, res) => {
    if (!fs.existsSync(backupDir)) {
        return res.json([]);
    }

    const files = fs.readdirSync(backupDir)
        .filter(file => file.endsWith('.db'))
        .map(file => ({
            name: file,
            size: fs.statSync(path.join(backupDir, file)).size,
            date: fs.statSync(path.join(backupDir, file)).mtime
        }))
        .sort((a, b) => b.date - a.date);

    res.json(files);
});

// تحميل نسخة احتياطية
app.get('/newstart/api/backups/:filename', (req, res) => {
    const filePath = path.join(backupDir, req.params.filename);

    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('الملف غير موجود');
    }
});

// حذف نسخة احتياطية
app.delete('/newstart/api/backups/:filename', (req, res) => {
    const filePath = path.join(backupDir, req.params.filename);

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'تم حذف النسخة الاحتياطية' });
    } else {
        res.status(404).json({ success: false, message: 'الملف غير موجود' });
    }
});

// استعادة نسخة احتياطية
app.post('/newstart/api/restore', (req, res) => {
    try {
        const { backupFile } = req.body;
        const backupPath = path.join(backupDir, backupFile);

        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, message: 'الملف غير موجود' });
        }

        db.close((err) => {
            if (err) {
                console.error('خطأ في إغلاق قاعدة البيانات:', err);
            }

            fs.copyFileSync(backupPath, "/usr/src/app/newstartDB/database.db");

            const newDb = new sqlite3.Database(currentDbPath);
            db = newDb;

            console.log('تم استعادة النسخة الاحتياطية بنجاح:', backupFile);
            res.json({
                success: true,
                message: 'تم استعادة النسخة الاحتياطية بنجاح'
            });
        });
    } catch (err) {
        console.error('خطأ في الاستعادة:', err);
        res.status(500).json({ success: false, message: 'فشل في استعادة النسخة الاحتياطية' });
    }
});

// معلومات قاعدة البيانات
app.get('/newstart/api/db-info', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM subscribers", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'خطأ في جلب معلومات قاعدة البيانات' });
        }
        res.json({ subscribersCount: row.count });
    });
});
function addLog(username, action, details) {
    const timestamp = new Date().toISOString().replace("T", " ").split(".")[0]; 
    db.run(
        `INSERT INTO logs (timestamp, username, action, details) VALUES (?, ?, ?, ?)`,
        [timestamp, username, action, details],
        (err) => {
            if (err) {
                console.error("Error inserting log:", err);
            }
        }
    );
}
// جلب كل السجلات
app.get('/api/logs', async (req, res) => {
    const { search, dateFrom, dateTo } = req.query;
    
    let query = 'SELECT * FROM logs';
    let conditions = [];
    let params = [];
    
    if (search) {
        conditions.push(`(username LIKE ? OR action LIKE ? OR details LIKE ?)`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (dateFrom) {
        conditions.push(`DATE(timestamp) >= ?`);
        params.push(dateFrom);
    }
    
    if (dateTo) {
        conditions.push(`DATE(timestamp) <= ?`);
        params.push(dateTo);
    }
    
    if (conditions.length) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY timestamp DESC';
    
    try {
        // استخدام db.all() لـ SQLite
        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Error fetching logs:', err);
                res.status(500).json({ error: 'Internal server error' });
            } else {
                res.json(rows);
            }
        });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// جلب السجلات مع بحث
app.get("/api/logs/search", (req, res) => {
    const search = `%${req.query.q || ""}%`;
    db.all(
        `SELECT * FROM logs 
         WHERE username LIKE ? OR action LIKE ? OR details LIKE ?
         ORDER BY log_id DESC`,
        [search, search, search],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json(rows);
        }
    );
});
// بدء الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
