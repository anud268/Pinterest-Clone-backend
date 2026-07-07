import mongoose from "mongoose";
import dotenv from 'dotenv'
dotenv.config()
const URL = process.env.MONGODB

const dbConnect = async() =>{
    try {
        const connect = await mongoose.connect(URL)
        console.log('MONGODB connected');
    } catch (error) {
        console.log(error);
    }
}
export default dbConnect