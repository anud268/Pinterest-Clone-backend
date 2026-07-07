import User from '../schema/userSchema.js'
import Otp from '../schema/otpSchema.js'
import Profile from '../schema/profileSchema.js'

export const signupServ = async(data)=>{
    try {
        const user = await User.create(data)
        return {user}
    } catch (error) {
        console.log(error);
    }
}
export const checkEmailServ = async(data)=>{
    try {
        console.log('check existing email-',data);
        
        const check = await User.findOne({email:data})
        console.log('ueser check from serv-',check);
        
        return check
    } catch (error) {
        console.log(error);
    }
}

export const reqOtpServ= async(email,otp)=>{
    try {
        const response = await Otp.create({email,otp})
        return response
    } catch (error) {
        console.log(error);
    }
}
export const removeOtpServ = async(data)=>{
    try {
        const response = await Otp.findByIdAndDelete(data)
        return response
    } catch (error) {
        console.log(error);
    }
}


export const signinServ= async(data)=>{
    try {
        const email= data.email
        const possword= data.password
        const user = await User.findOne({email})
        console.log('check user:',user);
        if(user){
            return user
        }else{
            return {success:false}
        }
    } catch (error) {
        console.log(error);
    }
}

export const userDetialsServ=async(data)=>{
    try {
        const response = await User.findById(data)
        return response
    } catch (error) {
        console.log(error);
    }
}


// profile

export const setProfileServ = async(data)=>{
    try {
        console.log('create profile-',data);
        
        const response = await Profile.create(data)
        return response
    } catch (error) {
        console.log(error);
    }
}
export const updateProfileServ = async(userId,data)=>{
    try {
        console.log('data from services-',data);
        if(data.image){
            const response = await Profile.findOneAndUpdate({userId:userId},{image:data.image},{new:true})
            return response
        }else{
            const response = await Profile.findOneAndUpdate({userId:userId},{
                firstname:data.firstname,
                lastname:data.lastname,
                bio:data.bio,
                country:data.country,
                state:data.state
            },{new:true})
            return response
        }
        
    } catch (error) {
        console.log(error);
    }
}
export const FindUserProfile = async(data)=>{
    try {
        const response = await Profile.findOne({userId:data})
        return response
    } catch (error) {
        console.log(error);
    }
}

export const fetchProfilePicServ = async(data)=>{
    try {
        const response = await Profile.findOne({userId:data})
        console.log('response of profile pic:',response);
        return response.image
        
    } catch (error) {
        console.log(error);
    }
}

export const userBlockServ = async(id,data)=>{
    try {

        console.log('heloooooo');
        
        const isBlock = await User.findOne({_id: id,userblock: { $in: data }});

        console.log(isBlock,'isblock'); 
        if(!isBlock){
            const response = await User.findByIdAndUpdate(id,{$push:{userblock:data}},{new:true}) 
            console.log(response,'+++++++++++++ PUSH +++++++++++++');
            return {response,success:true}
        }else{
            const response = await User.findByIdAndUpdate(id,{$pull:{userblock:data}},{new:true})
            console.log(response,'+++++++++++++ PULL +++++++++++++');
            return {response,success:false}
        }
        

        

    } catch (error) {
        console.log(error);
    }
}

export const fetchIsblockServ = async(userId,blockUserId)=>{
    try {
         const isBlock = await User.findOne({_id: userId,userblock: { $in: blockUserId }});
        if(isBlock){
            return {success:true}
        }else{
            return {success:false}
        }
    } catch (error) {
        console.log(error);
    }
}

export const blockedUsersServ =async(id)=>{
    try {
        const response = await User.find({userblock:{$in:id}}).sort({updatedAt:-1})
        console.log(response,'oOoOoOoOoOoOoOoOoOo');
        return response
        
    } catch (error) {
        console.log(error);
    }
}