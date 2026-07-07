import Post from '../schema/postSchema.js'
import Tag from '../schema/tagSchema.js';
import User from '../schema/userSchema.js';

export const uploadPostServ = async (post, tag) => {
    try {
        const response = await Post.create({
            ...post,
            tags: Array.isArray(tag) ? tag : [tag] // Ensure tags is always an array
        });
        return response;
    } catch (error) {
        console.log(error);
    }
};
export const fetchPostServ = async(data)=>{
    try {
        const response = await Post.find({archive:false,adminStrike:false,interested:{$nin:data}}).sort({createdAt:-1}).populate({path:"userId", select:"fullname email adminblock",match: { adminblock: { $ne: true } ,userblock:{$nin:data}}})
        const filteredResponse = response.filter(post => post.userId !== null);
        return filteredResponse  
    } catch (error) {
        console.log(error);
    }
}
export const servViewPost =async(id)=>{
    try {
        const post = await Post.findById(id).populate({path:"userId", select:"fullname email adminblock"})
        return post
    } catch (error) {
        console.log(error);
    }
}

export const fetchMyPostServ = async(data)=>{
    try {
        const response = await Post.find({userId:data,archive:false}).sort({createdAt:-1})
        return response
    } catch (error) {
        console.log(error);
    }
}
export const deletePostServ = async (data) =>{
    try {
        const response = await Post.findByIdAndDelete(data)
        return response
    } catch (error) {
        console.log(error);
    }
}
export const updatePostServ = async(postId,data)=>{
    try {
        console.log('update data:',data);
        const response = await Post.findByIdAndUpdate(postId,data,{new:true})
        console.log('update in service:',response);
        return response
    } catch (error) {
        console.log(error);
    }
}

//saved

export const checkHaveUserServ =async(postId,userId)=>{
    try {
        const  response = await Post.findOne({ _id: postId, saved: userId })
        // console.log('response of have user:',response);
        
        return response
    } catch (error) {
        console.log(error);
    }
}
export const pushSaveItem = async(postId,userId)=>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{$push:{saved:userId}},{ new: true })
        return response
    } catch (error) {
        console.log(error);
    }
}
export const pullsavedItem = async(postId,userId)=>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{$pull:{saved:userId}},{ new: true })
        return response
    } catch (error) {
        console.log(error);
    }
}

export const fetchSavedPostsServ=async (data)=>{
    try {
        const response =await Post.find({saved:{$in:data},archive:false,adminStrike:false,interested:{$nin:data}}).sort({updatedAt:-1})
        console.log('saved posts from serv:',response);
        
        return response
    } catch (error) {
        console.log(error);
    }
}

//archive
export const pusharchiveServ = async(postId)=>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{archive:true},{ new: true })
        return response
    } catch (error) {
        console.log(error);
    }
}
export const pullArchiveServ = async(postId)=>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{archive:false},{ new: true })
        return response
    } catch (error) {
        console.log(error);
    }
}

export const fetchArchiveServ=async (id)=>{
    try {
        const response =await Post.find({archive:true,userId:{$eq:id}}).sort({updatedAt:-1})
        console.log('archive posts from serv:',response);
        
        return response
    } catch (error) {
        console.log(error);
    }
}

// search

export const searchTermsServ = async(searchValue,select,userId)=>{
    try {
        if(select=='Title'){
            console.log('userId from search---',userId);
            
            const title = await Post.distinct("postTitle",{archive: { $ne: true } , postTitle:{ $regex: searchValue, $options: 'i' }})
            console.log('title----',title);
            
            return title
        }
        else if(select=='Tag'){
            const tag = await Post.distinct("tags",{archive: { $ne: true } , tags:{ $regex: searchValue, $options: 'i' }})
            return tag
        }
        else if(select=='Location'){
            const location = await Post.distinct("location",{archive: { $ne: true } , location:{ $regex: searchValue, $options: 'i' }})
            return location
        }
        else if(select=='User'){
            const user = await User.find({ fullname:{ $regex: searchValue, $options: 'i' }},{ _id: 1, fullname: 1 })
            return user
        }

    } catch (error) {
        console.log(error);
    }
}

export const finalSearchServ = async (searchValue,select)=>{
    try {
        if(select=='Title'){
            const title = await Post.find({postTitle:{ $regex: searchValue, $options: 'i' }})
            
            return title
        }
        else if(select=='Tag'){
            const tag = await Post.find({tags:{$regex: searchValue , $options:'i'}})
            return tag
        }
        else if(select=='Location'){
            const location = await Post.find({location:{ $regex: searchValue, $options: 'i' }})
            return location
        }

    } catch (error) {
        console.log(error);
    }
}

export const notInterestedServ =async(userId,postId)=>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{$push:{interested:userId}},{ new: true })
        return response
    } catch (error) {
        console.log(error);        
    }
}

export const fetchNotInterestedServ =async(data)=>{
    try {
        const response = await Post.find({archive:false,interested:{$in:data}}).sort({createdAt:-1}).populate({path:"userId", select:"fullname email adminblock",match: { adminblock: { $ne: true } }})
        return response
    } catch (error) {
        console.log(error);
    }
}

export const removeNotInterestServ = async(postId,userId) =>{
    try {
        const response = await Post.findByIdAndUpdate(postId,{$pull:{interested:userId}},{ new: true })
        return response
    } catch (error) {
        console.log(error);
    }
}

export const applyTagServ=async(value)=>{
    try {
        const response =await Tag.find({tags:{$elemMatch:{$regex:value , $options:'i'}}},{tags:1,_id:0})
        console.log('======',response,'======');
        
        return response
    } catch (error) {
        console.log(error);
    }
}