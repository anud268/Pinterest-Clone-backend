import express from "express";
import cors from "cors";
import dotenv from 'dotenv'
import db from './db.js'
import cookieParser from "cookie-parser";
import router from "./route/user.js";
dotenv.config()
const app = express()
const PORT = process.env.PORT

db()

app.use(express.json())
app.use(cookieParser())

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}))

app.use('/', router)

app.listen(PORT, () => {
    console.log(`server running port ${PORT}..`);
})