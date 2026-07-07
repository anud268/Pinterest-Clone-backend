import { applyTagServ, checkHaveUserServ, deletePostServ,  fetchArchiveServ,  fetchMyPostServ, fetchNotInterestedServ, fetchPostServ,  fetchSavedPostsServ,  finalSearchServ,  notInterestedServ,  pullArchiveServ,  pullsavedItem, pusharchiveServ, pushSaveItem, removeNotInterestServ, searchTermsServ, servViewPost, updatePostServ, uploadPostServ } from "../services/post.js";
import fs from 'fs';

export const uploadPost = async (req, res) => {
  try {
    const { title, description, location, userId, url } = req.body;
    let { tags } = req.body;

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!title || !description || !userId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Parse tags safely
    let parsedTags = [];

    if (typeof tags === "string") {
      parsedTags = tags
        .split(",")
        .map(tag => tag.trim())
        .filter(tag => tag);
    } else if (Array.isArray(tags)) {
      parsedTags = tags;
    }

    // Read file from disk
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer], { type: file.mimetype });

    const formData = new FormData();
    formData.append('file', blob, file.originalname);
    formData.append('fileName', file.originalname);
    formData.append('folder', '/Pinterest/Posts');

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
      console.error("ImageKit upload failed for post:", errorResult);
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        console.error("Error deleting temporary file:", err);
      }
      return res.status(uploadResponse.status).json({ message: "ImageKit upload failed", error: errorResult });
    }

    const result = await uploadResponse.json();
    const imageUrl = result.url;

    // Clean up temporary file
    try {
      fs.unlinkSync(file.path);
    } catch (err) {
      console.error("Error deleting temporary file:", err);
    }

    // Save to DB
    const post = await uploadPostServ(
      {
        postTitle: title,
        postDescription: description,
        url: url || "",
        location,
        userId,
        postImage: imageUrl,
      },
      parsedTags
    );

    return res.status(200).json({
      message: "Uploaded successfully",
      post,
      success: true,
    });

  } catch (error) {
    console.error("Upload failed:", error);
    return res.status(500).json({
      message: "Upload failed",
      success: false,
    });
  }
};




export const fetchPost =async (req,res) => {
    try {
        const {id} = req.params

        const posts = await fetchPostServ(id)
        res.status(200).json(posts)
        
    } catch (error) {
        console.log(error);
    }
}
export const viewPost =async(req,res)=>{
    try {
        const {id} = req.params
        const response = await servViewPost(id)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}



export const fetchMyPost =async (req,res) => {
    try {
        
        const {id}  = req.params
        const posts = await fetchMyPostServ(id)
        res.status(200).json(posts)
        
    } catch (error) {
        console.log(error);
    }
}

export const deletePost = async(req,res)=>{
    try {
        const {postId} = req.body
        const response = await deletePostServ(postId)
        res.status(200).json({message:'post deleted successfully'})
        
    } catch (error) {
     console.log(error);
    }
}
export const updatePost = async (req, res) => {
    try {
        const { postId } = req.params;
        
        // Read from body (FormData) or query params
        const title = req.body.title !== undefined ? req.body.title : req.query.title;
        const description = req.body.description !== undefined ? req.body.description : req.query.description;
        const location = req.body.location !== undefined ? req.body.location : req.query.location;
        const url = req.body.url !== undefined ? req.body.url : req.query.url;
        let tags = req.body.tags !== undefined ? req.body.tags : req.query.tags;

        // Convert tags string to array
        if (typeof tags === 'string') {
            tags = tags.split(',').map(tag => tag.trim()).filter(tag => tag !== "");
        } else if (!Array.isArray(tags)) {
            tags = [];
        }

        const updateData = {
            postTitle: title,
            postDescription: description,
            location: location,
            tags: tags,
            url: url,
        };

        // If a new image file is uploaded
        if (req.file) {
            const file = req.file;

            // Read file from disk
            const fileBuffer = fs.readFileSync(file.path);
            const blob = new Blob([fileBuffer], { type: file.mimetype });

            const formData = new FormData();
            formData.append('file', blob, file.originalname);
            formData.append('fileName', file.originalname);
            formData.append('folder', '/Pinterest/Posts');

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
                console.error("ImageKit upload failed during update:", errorResult);
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error("Error deleting temporary file:", err);
                }
                return res.status(uploadResponse.status).json({ message: "ImageKit upload failed", error: errorResult });
            }

            const result = await uploadResponse.json();
            updateData.postImage = result.url; // Save new ImageKit URL

            // Clean up temporary file
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                console.error("Error deleting temporary file:", err);
            }
        }

        const update = await updatePostServ(postId, updateData);

        res.status(200).json({ update, success: true });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};


//save
export const pushSave = async(req,res)=>{
    try {
        const {postId,userId} = req.body
        //find user
        const haveUser = await checkHaveUserServ(postId,userId)

        if(!haveUser){
            //push postId
            const savedPosts = await pushSaveItem(postId,userId)
            res.status(200).json({message:'post saved successfully',success:true})
        }else{
            //pull postId
            const removeSave = await pullsavedItem(postId,userId)
            res.status(200).json({message:'remove post from saved',success:false})
        }
    } catch (error) {
        console.log(error);
    }
}

export const fetchSavedPosts = async(req,res) =>{
    try {
        const {userId} = req.params
        const savedPosts = await fetchSavedPostsServ(userId)
        res.status(200).json(savedPosts)
    } catch (error) {
        console.log(error);
    }
}

//archive

export const fetchArchivePost =async (req,res) => {
    try {
        const {userId} = req.params
        
        const posts = await fetchArchiveServ(userId)
        
        res.status(200).json(posts)
    } catch (error) {
        console.log(error);
    }
}
export const archivePost = async(req,res)=>{
    try {
        const {postId,userId} = req.body
        const arvhive = pusharchiveServ(postId,userId)
        res.status(200).json({message:'post is archived'})
    } catch (error) {
        console.log(error);
    }
}
export const unArchivePost = async(req,res)=>{
    try {
        const {postId,userId} = req.body
        const arvhive = pullArchiveServ(postId,userId)
        res.status(200).json({message:'posta is unarchived'})
    } catch (error) {
        console.log(error);
    }
}
//search
export const searchTerms =async (req,res)=>{
    try {
        const {searchValue,select,userId} = req.query
        const result = await searchTermsServ(searchValue,select,userId)
        res.status(200).json(result)
    } catch (error) {
        console.log(error);
    }
}
export const finalSearch =async(req,res)=>{
    try {
        const {searchValue,select} = req.body
        const result  = await finalSearchServ(searchValue,select)
        res.status(200).json(result)
    } catch (error) {
        console.log(error);
    }
}
export const notInterested =async(req,res)=>{
    try {
        const {userId,postId} = req.body
        const response = await notInterestedServ(userId,postId)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const fetchNotInterested =async(req,res)=>{
    try {
        const {id} = req.params
        const response = await fetchNotInterestedServ(id)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const removeNotInterest =async(req,res)=>{
    try {const {postId,userId} = req.body
        const response = await removeNotInterestServ(postId,userId)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}

export const applyTag = async(req,res)=>{
    try {
        const {value} = req.params
        const response = await applyTagServ(value)
        res.status(200).json(response)
        
    } catch (error) {
        console.log(error);
    }
}