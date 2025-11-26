import express from 'express'
import bcrypt from 'bcryptjs'
import pool from '../database/db.js'
import validator from "validator"
import multer from 'multer'
import path from 'path'
import { sendVerificationEmail } from '../email/brevo.js'
import { sendSMS } from "../services/smsService.js"

const verificationStore = {}
const passwordResetStore = {}

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
        console.log("📩 Register route triggered for:", email)
        console.log("🟢 Calling sendVerificationEmail...")

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
        console.log("📩 Register route triggered for:", email)
        console.log("🧩 Checking if user already exists:", findUser.length)
        await sendVerificationEmail(email, verifCode)
        console.log("✅ sendVerificationEmail() finished")
        return res.status(201).json({ message: "Verification code sent. Please check your email" })
    } catch (err) {
        console.error(err.message)
        return res.status(500).json({ error: "Internal server error" })
    }
})

router.post("/register/verify", async(req, res) => {
    try {
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
        if (phone) {
            const smsMessage = `Hi ${username}, your account for Bataan Heroes College - (Document Request) has been successfully created!`
            await sendSMS(phone, smsMessage)
        }
        delete verificationStore[email]
        return res.status(201).json({ message: "Account Created Successfully", userId })
    } catch (err) {
        console.error("Error creating user:", err.message)
        return res.status(500).json({ error: "Internal server error" })
    }
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

        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" })
        }

        if (!request_id) {
        return res.status(400).json({ message: "request_id is required" })
        }

        console.log("Updating request with:", {
            path: req.file.path,
            reference_no: reference_number,
            amount: amount_sent,
            request_id: request_id
        })

        const [result] = await pool.query(
            `UPDATE requests 
            SET payment_attachment = ? WHERE request_id = ?`,
            [req.file.path, request_id]
        )

        console.log("Update result:", result)

        if (result.affectedRows === 0) {
        console.error("No rows updated - request_id might not exist")
        return res.status(404).json({ message: "Request not found" })
        }

        res.status(200).json({
        message: "File uploaded successfully",
        file: {
            name: req.file.originalname,
            path: `/attachments/${req.file.filename}`,
            url: `${req.protocol}://${req.get("host")}/attachments/${req.file.filename}`
        }
        })

    } catch (err) {
        console.error("Upload Error:", err)
        res.status(500).json({ 
        message: "Internal server error",
        details: err.message 
        })
    }
})

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
    } = req.body

    if (!answerOne || !answerTwo || !answerThree || !email || !username || !course || !role || !password) {
      return res.status(400).json({ message: "All fields are required." })
    }

    const normalize = str =>
      str
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")

    const a1 = normalize(answerOne)
    const a2 = normalize(answerTwo)
    const a3 = normalize(answerThree)

    const validA1 = [
      "engr. sesenio s. rosales and gloria laureana s. rosales",
      "gloria laureana s. rosales and engr. sesenio s. rosales",
    ]
    const validA2 = [
      "honors the defenders of bataan in world war 2",
      "honors the defenders of bataan in world war ii",
    ]
    const validA3 = ["gloria laureana s. rosales"]

    if (!validA1.includes(a1)) return res.status(400).json({ message: "Incorrect answer for question 1." })
    if (!validA2.includes(a2)) return res.status(400).json({ message: "Incorrect answer for question 2." })
    if (!validA3.includes(a3)) return res.status(400).json({ message: "Incorrect answer for question 3." })

    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    const verifCode = Math.floor(100000 + Math.random() * 900000)

    verificationStore[email] = {
      verifCode,
      username,
      studentNumber,
      course,
      role,
      hashedPassword,
      expiresAt: Date.now() + 5 * 60 * 1000,
    }

    await sendVerificationEmail(email, verifCode)

    return res.status(201).json({ message: "Verification code sent. Check your email." })
  } catch (error) {
    console.error("Error in alumni confirmation:", error)
    return res.status(500).json({ message: "Internal server error." })
  }
})

// Add this to your existing auth.js file

// Store for admin account verification (add at the top with other stores)
const adminVerificationStore = {}

// Replace the existing /create-account-admin route with this:
router.post("/create-account-admin", async(req, res) => {
    try {
        const { username, email, password, role, department } = req.body
        
        // Check if user already exists
        const [findUser] = await pool.query(
            "SELECT * FROM user WHERE username = ? OR email = ?", 
            [username, email]
        )
        
        if (findUser.length > 0) {
            return res.status(400).json({ 
                message: "User with this username / email already exists" 
            })
        }

        // Validate password strength
        if (
            !validator.isStrongPassword(password, {
                minLength: 8,
                minLowercase: 1,
                minUppercase: 1,
                minNumbers: 1,
                minSymbols: 1,
            })
        ) {
            return res.status(400).json({ 
                message: "Password is too weak. It must be at least 8 characters long and include uppercase, lowercase, number, and symbol." 
            })
        }

        // Hash password
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(password, saltRounds)

        // Generate verification code
        const verifCode = Math.floor(100000 + Math.random() * 900000)

        // Store admin account data temporarily
        adminVerificationStore[email.toLowerCase()] = {
            verifCode,
            username,
            hashedPassword,
            role,
            department,
            expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
        }

        // Send verification email
        await sendVerificationEmail(email, verifCode)

        console.log(`Admin verification code sent to ${email}: ${verifCode}`)

        return res.status(200).json({ 
            message: "Verification code sent to email. Please check your inbox." 
        })

    } catch (err) {
        console.error(err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

// Add new route for verifying admin account creation
router.post("/verify-admin-creation", async(req, res) => {
    try {
        const { email, code } = req.body

        if (!email || !code) {
            return res.status(400).json({ message: "Email and code are required" })
        }

        const entry = adminVerificationStore[email.toLowerCase()]

        if (!entry) {
            return res.status(400).json({ 
                message: "No verification request found. Please start over." 
            })
        }

        if (entry.expiresAt < Date.now()) {
            delete adminVerificationStore[email.toLowerCase()]
            return res.status(400).json({ 
                message: "Verification code expired. Please request a new one." 
            })
        }

        if (entry.verifCode != code) {
            return res.status(400).json({ message: "Invalid verification code" })
        }

        // Create the admin account
        const { username, hashedPassword, role, department } = entry

        const [result] = await pool.query(
            "INSERT INTO user (username, email, password, course, role, department) VALUES(?, ?, ?, ?, ?, ?)", 
            [username, email.toLowerCase(), hashedPassword, "N/A", role, department]
        )

        // Clean up verification store
        delete adminVerificationStore[email.toLowerCase()]

        console.log(`Admin account created successfully for ${email}`)

        return res.status(200).json({ 
            message: "Admin account created successfully!" 
        })

    } catch (err) {
        console.error("Verify admin creation error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body
        
        if (!email) {
        return res.status(400).json({ message: "Email is required" })
        }

        const [findUser] = await pool.query(
        "SELECT * FROM user WHERE email = ?",
        [email.toLowerCase()]
        )

        if (findUser.length === 0) {
        return res.status(404).json({ message: "No account found with this email" })
        }

        const resetCode = Math.floor(100000 + Math.random() * 900000)

        passwordResetStore[email.toLowerCase()] = {
        resetCode,
        userId: findUser[0].uid,
        expiresAt: Date.now() + 15 * 60 * 1000
        }

        await sendVerificationEmail(email, resetCode)

        console.log(`Password reset code sent to ${email}: ${resetCode}`)

        return res.status(200).json({ 
        message: "Verification code sent to your email. Please check your inbox." 
        })

    } catch (err) {
        console.error("Forgot password error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

router.post("/verify-reset-code", async (req, res) => {
    try {
        const { email, code } = req.body

        if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" })
        }

        const entry = passwordResetStore[email.toLowerCase()]

        if (!entry) {
        return res.status(400).json({ message: "No reset request found for this email" })
        }

        if (entry.expiresAt < Date.now()) {
        delete passwordResetStore[email.toLowerCase()]
        return res.status(400).json({ message: "Verification code expired. Please request a new one." })
        }

        if (entry.resetCode != code) {
        return res.status(400).json({ message: "Invalid verification code" })
        }

        return res.status(200).json({ 
        message: "Code verified successfully",
        verified: true 
        })

    } catch (err) {
        console.error("Verify reset code error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

router.post("/reset-password", async (req, res) => {
    try {
        const { email, code, newPassword } = req.body

        if (!email || !code || !newPassword) {
        return res.status(400).json({ message: "Email, code, and new password are required" })
        }

        const entry = passwordResetStore[email.toLowerCase()]

        if (!entry) {
        return res.status(400).json({ message: "No reset request found. Please start over." })
        }

        if (entry.expiresAt < Date.now()) {
        delete passwordResetStore[email.toLowerCase()]
        return res.status(400).json({ message: "Verification code expired. Please request a new one." })
        }

        if (entry.resetCode != code) {
        return res.status(400).json({ message: "Invalid verification code" })
        }

        if (
        !validator.isStrongPassword(newPassword, {
            minLength: 8,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 1,
        })
        ) {
        return res.status(400).json({ 
            message: "Password is too weak. It must be at least 8 characters long and include uppercase, lowercase, number, and symbol." 
        })
        }

        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds)

        const [result] = await pool.query(
        "UPDATE user SET password = ? WHERE uid = ?",
        [hashedPassword, entry.userId]
        )

        if (result.affectedRows === 0) {
        return res.status(404).json({ message: "User not found" })
        }

        delete passwordResetStore[email.toLowerCase()]

        console.log(`Password reset successful for user ID: ${entry.userId}`)

        return res.status(200).json({ 
        message: "Password reset successfully. You can now login with your new password." 
        })

    } catch (err) {
        console.error("Reset password error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

router.put("/update-profile", async (req, res) => {
    try {
        const { userId, username, course, studentNumber, phone } = req.body

        if (!userId) {
            return res.status(400).json({ message: "User ID is required" })
        }

        // Check if username is taken by another user
        if (username) {
            const [existingUser] = await pool.query(
                "SELECT uid FROM user WHERE username = ? AND uid != ?",
                [username, userId]
            )
            if (existingUser.length > 0) {
                return res.status(400).json({ message: "Username already taken" })
            }
        }

        // Check if student number is taken by another user
        if (studentNumber) {
            const [existingStudent] = await pool.query(
                "SELECT uid FROM user WHERE student_number = ? AND uid != ?",
                [studentNumber, userId]
            )
            if (existingStudent.length > 0) {
                return res.status(400).json({ message: "Student number already in use" })
            }
        }

        // Build dynamic update query
        const updates = []
        const values = []

        if (username) {
            updates.push("username = ?")
            values.push(username.trim())
        }
        if (course) {
            updates.push("course = ?")
            values.push(course)
        }
        if (studentNumber) {
            updates.push("student_number = ?")
            values.push(studentNumber)
        }
        if (phone !== undefined) {
            updates.push("phone = ?")
            values.push(phone)
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: "No fields to update" })
        }

        values.push(userId)
        
        const [result] = await pool.query(
            `UPDATE user SET ${updates.join(", ")} WHERE uid = ?`,
            values
        )

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User not found" })
        }

        // Get updated user data
        const [updatedUser] = await pool.query(
            "SELECT uid, username, email, phone, student_number, course, role, department FROM user WHERE uid = ?",
            [userId]
        )

        return res.status(200).json({ 
            message: "Profile updated successfully",
            user: updatedUser[0]
        })

    } catch (err) {
        console.error("Update profile error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

// Request email change verification
router.post("/request-email-change", async (req, res) => {
    try {
        const { userId, currentEmail, newEmail } = req.body

        if (!userId || !currentEmail || !newEmail) {
            return res.status(400).json({ message: "All fields are required" })
        }

        // Verify user exists and current email matches
        const [user] = await pool.query(
            "SELECT uid, email FROM user WHERE uid = ?",
            [userId]
        )

        if (user.length === 0) {
            return res.status(404).json({ message: "User not found" })
        }

        if (user[0].email.toLowerCase() !== currentEmail.toLowerCase()) {
            return res.status(400).json({ message: "Current email doesn't match" })
        }

        // Check if new email is already in use
        const [existingEmail] = await pool.query(
            "SELECT uid FROM user WHERE email = ? AND uid != ?",
            [newEmail.toLowerCase(), userId]
        )

        if (existingEmail.length > 0) {
            return res.status(400).json({ message: "Email already in use" })
        }

        // Generate verification code
        const verifCode = Math.floor(100000 + Math.random() * 900000)

        // Store in verification store
        const emailChangeKey = `email_change_${userId}`
        verificationStore[emailChangeKey] = {
            verifCode,
            userId,
            newEmail: newEmail.toLowerCase(),
            expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
        }

        // Send verification email to NEW email
        await sendVerificationEmail(newEmail, verifCode)

        return res.status(200).json({ 
            message: "Verification code sent to your new email address" 
        })

    } catch (err) {
        console.error("Request email change error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

// Verify and complete email change
router.post("/verify-email-change", async (req, res) => {
    try {
        const { userId, code } = req.body

        if (!userId || !code) {
            return res.status(400).json({ message: "User ID and code are required" })
        }

        const emailChangeKey = `email_change_${userId}`
        const entry = verificationStore[emailChangeKey]

        if (!entry) {
            return res.status(400).json({ message: "No email change request found" })
        }

        if (entry.expiresAt < Date.now()) {
            delete verificationStore[emailChangeKey]
            return res.status(400).json({ message: "Verification code expired" })
        }

        if (entry.verifCode != code) {
            return res.status(400).json({ message: "Invalid verification code" })
        }

        // Update email in database
        const [result] = await pool.query(
            "UPDATE user SET email = ? WHERE uid = ?",
            [entry.newEmail, userId]
        )

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User not found" })
        }

        // Get updated user data
        const [updatedUser] = await pool.query(
            "SELECT uid, username, email, phone, student_number, course, role, department FROM user WHERE uid = ?",
            [userId]
        )

        // Clean up verification store
        delete verificationStore[emailChangeKey]

        return res.status(200).json({ 
            message: "Email updated successfully",
            user: updatedUser[0]
        })

    } catch (err) {
        console.error("Verify email change error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

// Change password (requires current password)
router.post("/change-password", async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body

        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ message: "All fields are required" })
        }

        // Get user's current password
        const [user] = await pool.query(
            "SELECT password FROM user WHERE uid = ?",
            [userId]
        )

        if (user.length === 0) {
            return res.status(404).json({ message: "User not found" })
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user[0].password)
        if (!isValid) {
            return res.status(401).json({ message: "Current password is incorrect" })
        }

        // Validate new password strength
        if (
            !validator.isStrongPassword(newPassword, {
                minLength: 8,
                minLowercase: 1,
                minUppercase: 1,
                minNumbers: 1,
                minSymbols: 1,
            })
        ) {
            return res.status(400).json({ 
                message: "Password is too weak. It must be at least 8 characters long and include uppercase, lowercase, number, and symbol." 
            })
        }

        // Hash new password
        const saltRounds = 10
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds)

        // Update password
        const [result] = await pool.query(
            "UPDATE user SET password = ? WHERE uid = ?",
            [hashedPassword, userId]
        )

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User not found" })
        }

        return res.status(200).json({ 
            message: "Password changed successfully" 
        })

    } catch (err) {
        console.error("Change password error:", err.message)
        return res.status(500).json({ message: "Internal server error" })
    }
})

export default router