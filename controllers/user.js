import bcrypt from 'bcrypt'
import nodemailer from 'nodemailer'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

import { blockedUsersServ, checkEmailServ, fetchIsblockServ, fetchProfilePicServ, FindUserProfile, removeOtpServ, reqOtpServ, setProfileServ, signinServ, signupServ, updateProfileServ, userBlockServ, userDetialsServ } from "../services/user.js"
import passport from 'passport'
import { response } from 'express'
import fs from 'fs'

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString(); 

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASS, 
    },
});

const sendOTPEmail = async (email, otp) => {
    await transporter.sendMail({
        from: process.env.EMAIL,
        to: email,
        subject: 'Your otp code',
        html: `<h3>Your OTP is: <b>${otp}</b></h3><p>It is valid for 5 minutes.</p>`,
    });
};

const requestOtp = async (email,otp) => {
  try {
    await sendOTPEmail(email, otp);
    const setOtp = await reqOtpServ( email, otp );  
    return setOtp
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const signup = async(req,res) =>{
    
    try {
        const {values} = req.body
        console.log('values===',values);
        
        const email = values.email
        const fullname = values.fullname
        const password = values.password
        const otp = generateOTP();
        const setOtp = await requestOtp(email,otp)
        const hashedPassword = await bcrypt.hash(values.password,10)
        const data ={email,fullname,password:hashedPassword}
        const checkUser = await checkEmailServ(email)
        console.log('check user-',checkUser);
        
        if(!checkUser){
            
            const user = await signupServ(data)
            
            await createToken(res,user)
            res.status(200).json({user,setOtp,success:true})
        }else{
            console.log('User already exist');
            
            res.status(200).json({message:'This email already exist'})
        }
    } catch (error) {
        console.log(error);
    }
}
export const createToken =async(res,user)=>{
    try {
        
        console.log('userId-',user);
        const token = jwt.sign(
            {userId:user._id},
            process.env.SECRET_KEY
        )
        console.log('token-',token);
        res.cookie('token',token,{
                httpOnly:true,
                secure: true,        
                sameSite: 'strict',  
                maxAge: 86400000       
            });
    } catch (error) {
        console.log(error);
    }
}
export const removeToken =async(res)=>{
    try {
        res.clearCookie('token', {
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        });
        // res.status(200).json({ message: 'Cookie cleared' });
    } catch (error) {
        console.log(error);
    }
}
export const logout= async(req,res)=>{
    try {
        await removeToken(res)
        res.status(200).json({ message: 'Cookie cleared' });
    } catch (error) {
        console.log(error);
    }
}
export const removeOtp =async(req,res)=>{
    try {
        const {otpId} = req.body
        const remove = await removeOtpServ(otpId)
        res.status(200).json({message:'OTP removed'})
    } catch (error) {
        console.log(error);
    }
}
export const resendOtp=async(req,res)=>{
    try {
        const {email} = req.body
        const otp = generateOTP()
        const setOtp = await requestOtp(email,otp)
        res.status(200).json({setOtp,success:true})
    } catch (error) {
        console.log(error);
    }
}

export const signin = async(req,res) =>{
    try {
        const {values} = req.body 
        console.log('signin values 1-',values.password);
        
        const user = await signinServ(values)
        console.log('signin values 2-',user);
        if(user.success==false){
            res.status(200).json({message:'This user not exist please check your mail address!'});
        }else{
        const isMatch = await bcrypt.compare(values.password, user.password);
        if (isMatch) {
            await createToken(res,user)
            res.status(200).json(user)
        } else {
            
            res.status(200).json({message:"Your password is Wrong!"})
        }
    }
        
    } catch (error) {
        console.log(error);
    }
}

export const fetchUser = async(req,res) =>{
    try {
        const token = req.cookies.token
        console.log('token fron fetch user',token);
        if(!token){
            res.status(200).json({message:'token not exist, User not found'})
        }else{
            const user = jwt.verify(token,process.env.SECRET_KEY)
            console.log('decoded token',user);
            const userDetials = await userDetialsServ(user.userId)
            console.log('user detials-',userDetials);
            res.status(200).json(userDetials)
        }
        
    } catch (error) {
        console.log(error);
    }
}



//profile

export const profilepic = async(req,res)=>{
    try {
        const {userId} = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ message: "No image file provided" });
        }

        // Read file from disk
        const fileBuffer = fs.readFileSync(file.path);
        const blob = new Blob([fileBuffer], { type: file.mimetype });
        
        const formData = new FormData();
        formData.append('file', blob, file.originalname);
        formData.append('fileName', file.originalname);
        formData.append('folder', '/Home/Pinterest/ProfilePicture');
        
        const authHeader = 'Basic ' + Buffer.from(process.env.IMAGEKIT_PRIVATE_KEY + ':').toString('base64');
        
        // Upload to ImageKit
        const uploadResponse = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
            method: 'POST',
            headers: {
                'Authorization': authHeader
            },
            body: formData
        });
        
        if (!uploadResponse.ok) {
            const errorResult = await uploadResponse.text();
            console.error("ImageKit upload failed:", errorResult);
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error("Error deleting temporary file:", err);
            }
            return res.status(uploadResponse.status).json({ message: "ImageKit upload failed", error: errorResult });
        }
        
        const result = await uploadResponse.json();
        const imageUrl = result.url;
        console.log('Uploaded image URL:', imageUrl);
        
        // Clean up temporary file
        try {
            fs.unlinkSync(file.path);
        } catch (err) {
            console.error("Error deleting temporary file:", err);
        }
        
        const userDataExist = await FindUserProfile(userId);
        console.log('userDataExist-', userDataExist);
        
        if (imageUrl) {
            if (userDataExist == null) {
                const response = await setProfileServ({image:imageUrl,userId:userId})
                res.status(200).json(response)
            } else {
                const updateData = await updateProfileServ(userId,{image:imageUrl,})
                res.status(200).json(updateData)
            }
        } else {
            res.status(500).json({ message: "Uploaded image URL is empty" });
        }

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
}


export const setProfile = async(req,res)=>{
    try {
        const {values,userId} = req.body
        console.log('valuesssssssssssss',values);
        
        
        
        const userDataExist = await FindUserProfile(userId)
        console.log('userDataExist-',userDataExist);
       
        if(userDataExist==null){
            const response = await setProfileServ({
                // image:s3Url,
                firstname:values.firstname,
                lastname:values.lastname,
                bio:values.bio,
                country:values.country,
                state:values.state,
                userId:userId
            })
            res.status(200).json(response)
        }else{
            const updateData = await updateProfileServ(userId,{
                // image:s3Url,
                firstname:values.firstname,
                lastname:values.lastname,
                bio:values.bio,
                country:values.country,
                state:values.state
            })
            res.status(200).json(updateData)
        }
        
    } catch (error) {
        console.log(error); 
    }
}
export const userProfile = async (req,res)=>{
    try {
        const userId = req.params.id
        
        const response = await FindUserProfile(userId)
        
        res.status(200).json(response)
        
    } catch (error) {
        console.log(error);
    }
}
export const fetchProfilePic = async(req,res)=>{
    try {
        console.log('id--',req.params);
        const {id} = req.params
        console.log('id--',id);
        
        const pic = await fetchProfilePicServ(id)
        res.status(200).json(pic)
    } catch (error) {
        console.log(error);
    }
}

export const userBlock =async(req,res)=>{
    try {
        console.log(';helllllllllll');
        
        const {id,userId} = req.body
        const response = await userBlockServ(id,userId) 
        res.status(200).json(response)

        
    } catch (error) {
        console.log(error);
    }
}

export const fetchIsblock = async(req,res)=>{
    try {
        console.log(req.query,'++++++++++++++++++++++');
        const {userId,blockUserId} = req.query
        console.log(userId,'++++++++++++++++++++++');
        console.log(blockUserId,'++++++++++++++++++++++');
        const response =await fetchIsblockServ(userId,blockUserId)
        console.log(response,'*********************************');
        
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}

export const blockedUsers =async(req,res)=>{
    try {
        const {id} = req.params
        const response = await blockedUsersServ(id)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}