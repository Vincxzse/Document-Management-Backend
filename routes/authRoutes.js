import express from 'express'
import bcrypt from 'bcryptjs'
import pool from '../database/db.js'
import validator from "validator"
import multer from 'multer'
import path from 'path'
import { sendVerificationEmail } from '../email/brevo.js'
import { sendNotificationSMS } from '../services/smsService.js'

const verificationStore = {}

const router = express.Router()

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'attachments/')
    },
    filename: function(req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`)
    }
})

const upload = multer({ storage })

router.post("/register-account", async (req, res) => {
    try {
        let { email, username, phone, password, course, role, studentNumber } = req.body
        email = email.toLowerCase()
        username = username.trim()
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(password, saltRounds)
        const [findUser] = await pool.query(
            "SELECT * FROM user WHERE email = ? OR username = ? OR student_number = ?",
            [email, username, studentNumber]
        )
        if (findUser.length > 0) return res.status(400).json({ message: "User already exists" })
        if (
            !validator.isStrongPassword(password, {
                minLength: 8,
                minLowercase: 1,
                minUppercase: 1,
                minNumbers: 1,
                minSymbols: 1,
            })
        ) {
            return res.status(400).json({ message: "Password is too weak. It must be at least 8 characters long and include uppercase, lowercase, number, and symbol.", })
        }
        if (role === "student") {
            const verifCode = Math.floor(100000 + Math.random() * 900000)
            verificationStore[email] = {
                verifCode,
                username,
                phone,
                studentNumber,
                course,
                role,
                hashedPassword,
                expiresAt: Date.now() + 5 * 60 * 1000
            }
            await sendVerificationEmail(email, verifCode)
            return res.status(201).json({ message: "Verification code sent. Please check your email" })
        } else if (role === "alumni") {
            return res.status(201).json({ message: "Redirecting to alumni confirmation" })
        }
    } catch (err) {
        console.error(err.message)
        return res.status(500).json({ error: "Internal server error" })
    }
})

router.post("/register/verify", async(req, res) => {
    const { email, code } = req.body
    const entry = verificationStore[email]
    if (!entry) return res.status(400).json({ message: "No verification request found" })
    if (entry.expiresAt < Date.now()) {
        delete verificationStore[email]
        return res.status(400).json({ message: "Verification code expired." })
    }
    if (entry.verifCode != code) {
        return res.status(400).json({ message: "Invalid code" })
    }
    const { username, phone, studentNumber, hashedPassword, course, role } = entry
    const [result] = await pool.query(
        "INSERT INTO user (email, username, phone, student_number, password, course, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [email, username, phone, studentNumber, hashedPassword, course, role]
    )
    const userId = result.insertId
    await pool.query(
        "INSERT INTO clearances (user_id, cashier_status) VALUES (?, ?)",
        [userId, 'Pending']
    )

    if (phone && phone.trim() !== "") {
        const formattedPhone = phone.replace(/^0/, '63')
        try {
            await sendNotificationSMS(formattedPhone, `Hi ${username}, your phone registration is complete!`)
            console.log(`SMS sent to ${formattedPhone}`)
        } catch (smsError) {
            console.error("SMS sending failed: ", smsError.message)
        }
    }
    delete verificationStore[email]
    return res.status(201).json({ message: "Account Created Successfully", userId })
})

router.post("/login", async (req, res) => {
    try {
        let { username, password } = req.body
        const [findUser] = await pool.query(
        "SELECT * FROM user WHERE username = ?",
        [username]
        )
        if (findUser.length === 0) {
        return res.status(400).json({ message: "User not found." })
        }
        const user = findUser[0]
        const isValid = await bcrypt.compare(password, user.password)
        if (!isValid) {
            return res.status(401).json({ message: "Incorrect Password" })
        }
        if (user.role === 'student') {
            const [getDocs] = await pool.query(
                "SELECT * FROM document_types WHERE name != 'Diploma' AND name != 'Certification of Graduation'"
            )
            res.status(200).json({
            message: "Login Successful",
            user,
            docs: getDocs,
            })
        } else if (user.role === 'alumni') {
            const [getDocs] = await pool.query("SELECT * FROM document_types")
            res.status(200).json({
            message: "Login Successful",
            user,
            docs: getDocs,
            })
        } else {
            const [getDocs] = await pool.query("SELECT * FROM document_types")
            res.status(200).json({
            message: "Login Successful",
            user,
            docs: getDocs,
            })
        }
    } catch (err) {
        console.error("Login Error:", err.message)
        res.status(500).json({ message: "Internal server error" })
    }
})

router.post("/upload-file", upload.single("file"), async (req, res) => {
    try {
        const { request_id, reference_number, amount_sent } = req.body

        console.log("=== UPLOAD DEBUG ===");
        console.log("request_id:", request_id);
        console.log("reference_number:", reference_number);
        console.log("amount_sent:", amount_sent);
        console.log("file:", req.file);

        if (!req.file) {
        console.error("No file uploaded");
        return res.status(400).json({ message: "No file uploaded" });
        }

        if (!request_id) {
        console.error("No request_id provided");
        return res.status(400).json({ message: "request_id is required" });
        }

        console.log("Updating request with:", {
        path: req.file.path,
        reference_no: reference_number,
        amount: amount_sent,
        request_id: request_id
        });

        const [result] = await pool.query(
        `UPDATE requests 
        SET payment_attachment = ?, reference_no = ?, amount = ? 
        WHERE request_id = ?`,
        [req.file.path, reference_number, amount_sent, request_id]
        );

        console.log("Update result:", result);

        if (result.affectedRows === 0) {
        console.error("No rows updated - request_id might not exist");
        return res.status(404).json({ message: "Request not found" });
        }

        res.status(200).json({
        message: "File uploaded successfully",
        file: {
            name: req.file.originalname,
            path: `/attachments/${req.file.filename}`,
            url: `${req.protocol}://${req.get("host")}/attachments/${req.file.filename}`
        }
        });

    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ 
        message: "Internal server error",
        details: err.message 
        });
    }
});

router.post("/register/alumni-confirmation", async (req, res) => {
  try {
    const {
      answerOne,
      answerTwo,
      answerThree,
      email,
      username,
      studentNumber,
      course,
      role,
      password,
    } = req.body;

    if (!answerOne || !answerTwo || !answerThree || !email || !username || !course || !role || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const normalize = str =>
      str
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const a1 = normalize(answerOne);
    const a2 = normalize(answerTwo);
    const a3 = normalize(answerThree);

    const validA1 = [
      "engr. sesenio s. rosales and gloria laureana s. rosales",
      "gloria laureana s. rosales and engr. sesenio s. rosales",
    ];
    const validA2 = [
      "honors the defenders of bataan in world war 2",
      "honors the defenders of bataan in world war ii",
    ];
    const validA3 = ["gloria laureana s. rosales"];

    if (!validA1.includes(a1)) return res.status(400).json({ message: "Incorrect answer for question 1." });
    if (!validA2.includes(a2)) return res.status(400).json({ message: "Incorrect answer for question 2." });
    if (!validA3.includes(a3)) return res.status(400).json({ message: "Incorrect answer for question 3." });

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const verifCode = Math.floor(100000 + Math.random() * 900000);

    verificationStore[email] = {
      verifCode,
      username,
      studentNumber,
      course,
      role,
      hashedPassword,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    await sendVerificationEmail(email, verifCode);

    return res.status(201).json({ message: "Verification code sent. Check your email." });
  } catch (error) {
    console.error("Error in alumni confirmation:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

router.post("/create-account-admin", async(req, res) => {
    const saltRounds = 10
    try {
        const { username, email, studentNo, password, course, role, department } = req.body
        const [findUser] = await pool.query("SELECT * FROM user WHERE username = ? OR email = ? OR student_number = ?", 
            [username, email, studentNo]
        )
        if (findUser.length > 0) {
            return res.status(400).json({ message: "User with this username / email / student number already exists" })
        }
        const hashedPassword = await bcrypt.hash(password, saltRounds)
        const [result] = await pool.query("INSERT INTO user (username, email, password, course, role, department, student_number) VALUES(?, ?, ?, ?, ?, ?, ?)", 
            [username, email, hashedPassword, course, role, department, studentNo]
        )
        return res.status(200).json({ message: "Account created successfully!" })
    } catch (err) {
        console.error(err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

export default router