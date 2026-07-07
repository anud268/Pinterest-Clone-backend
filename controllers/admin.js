import Card from "../schema/adminSchema.js";
import Post from "../schema/postSchema.js";
import Tag from "../schema/tagSchema.js";
import User from "../schema/userSchema.js";
import fs from 'fs';

export const userListAdmin = async (req, res) => {
    try {
        const response = await User.find({ role: { $ne: 'admin' } })
        console.log('user list-', response);

        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const adminblock = async (req, res) => {
    try {
        const { id } = req.body
        const isBlock = await User.findOne({ _id: id })
        if (isBlock.adminblock == false) {
            const response = await User.findByIdAndUpdate(id, { adminblock: true }, { new: true })
            res.status(200).json({ success: true })
        } else {
            const response = await User.findByIdAndUpdate(id, { adminblock: false }, { new: true })
            res.status(200).json({ success: false })
        }
    } catch (error) {
        console.log(error);
    }
}
export const fetchAllPosts = async (req, res) => {
    try {
        const response = await Post.find().sort({ createdAt: -1 }).populate('userId', 'fullname email  adminblock')
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const setExplore = async (req, res) => {
    try {
        const { title, subtitle } = req.body;
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
        formData.append('folder', '/Pinterest/ExploreManage');

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
            console.error("ImageKit upload failed for explore card:", errorResult);
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

        const response = await Card.create({ title, subtitle, image: imageUrl })
        console.log('response of set explore:', response);
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
}
export const fetchCards = async (req, res) => {
    try {
        const response = await Card.find()
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const removeCards = async (req, res) => {
    try {
        const { cardId } = req.body
        const response = await Card.findByIdAndDelete(cardId)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const addCategory = async (req, res) => {
    try {
        const { values } = req.body
        console.log(values);

        const response = await Tag.create(values)
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const fetchCat = async (req, res) => {
    try {
        const response = await Tag.find()
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const settags = async (req, res) => {
    try {
        const formData = req.body
        const tags = formData.tag
        const category = formData.category
        const response = await Tag.findByIdAndUpdate(category, { $push: { tags: tags } }, { new: true })
        res.status(200).json(response)
    } catch (error) {
        console.log(error);
    }
}
export const fetchTagsFromCard = async (req, res) => {
    try {
        const { cat } = req.body;

        // Fetch all Tag documents that match the given category
        const categoryDocs = await Tag.find({ category: cat });

        // Flatten all tags from the matched categories
        const allTags = categoryDocs.flatMap(doc => doc.tags);

        // Convert each tag into a regex pattern (case-insensitive)
        const regexTags = allTags.map(tag => new RegExp(tag, 'i'));

        // Find posts that have any matching tags
        const posts = await Post.find({
            tags: { $in: regexTags }
        });
        res.status(200).json(posts)

    } catch (error) {
        console.log(error);
    }
}


export const adminStrike = async (req, res) => {
    try {
        const { postId } = req.body
        const isStrike = await Post.findById(postId, { adminStrike: true });
        console.log(isStrike, 'isStrike');
        if (!isStrike.adminStrike) {
            const response = await Post.findByIdAndUpdate(postId, { adminStrike: true }, { new: true })
            res.status(200).json({ success: true })
        } else {
            const response = await Post.findByIdAndUpdate(postId, { adminStrike: false }, { new: true })
            res.status(200).json({ success: false })
        }

    } catch (error) {
        console.log(error);
    }
}
export const fetchActions = async (req, res) => {
    try {
        const { userId, postId } = req.query
        const isStrike = await Post.findById(postId, 'adminStrike');
        const isBlock = await User.findById(userId, 'adminblock');
        console.log(isBlock?.adminblock, 'isBlock');
        console.log(isStrike?.adminStrike, 'isStrike');
        res.status(200).json({ isBlock: isBlock?.adminblock || false, isStrike: isStrike?.adminStrike || false })

    } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
    }
}