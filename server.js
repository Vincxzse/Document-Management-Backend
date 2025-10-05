import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from "url"

import authRoutes from "./routes/authRoutes.js"
import requestRoutes from "./routes/requestRoutes.js"

const app = express()
const port = 5000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors())
app.use(express.json())

app.use("/attachments", express.static(path.join(__dirname, "attachments")))

app.use(authRoutes)
app.use(requestRoutes)

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})