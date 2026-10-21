import Card from "../schema/adminSchema.js";
import Post from "../schema/postSchema.js";
import Tag from "../schema/tagSchema.js";
import User from "../schema/userSchema.js";
import { FOLDERS, uploadImage } from "../services/imagekit.js";
import { postsForCategoryServ, withAuthorImages } from "../services/post.js";
import { profileImagesServ } from "../services/user.js";
import { badRequest, conflict, notFound } from "../utils/http.js";
import { cleanString, parsePagination, requireObjectId } from "../utils/validation.js";

const TAG_PATTERN = /^#[A-Za-z0-9_]{1,40}$/

export const userListAdmin = async (req, res) => {
    const users = await User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 })
    const images = await profileImagesServ(users.map((u) => u._id))
    res.status(200).json({ users: users.map((u) => ({ ...u.toJSON(), image: images.get(String(u._id)) || null })) })
}

export const adminblock = async (req, res) => {
    const id = requireObjectId(req.body?.id, 'user id')
    const user = await User.findById(id)
    if (!user) throw notFound('User not found')
    if (user.role === 'admin') throw badRequest("Administrators can't be blocked")

    const blocked = !user.adminblock
    await User.updateOne({ _id: id }, { adminblock: blocked })
    res.status(200).json({ blocked, message: blocked ? 'User blocked' : 'User unblocked' })
}

export const fetchAllPosts = async (req, res) => {
    const posts = await Post.find().sort({ createdAt: -1 }).populate('userId', 'fullname email adminblock')
    res.status(200).json({ posts: await withAuthorImages(posts) })
}

export const setExplore = async (req, res) => {
    const title = cleanString(req.body?.title, 60)
    const subtitle = cleanString(req.body?.subtitle, 200)
    if (!req.file) throw badRequest('Please choose an image')
    if (!title) throw badRequest('Please choose a category')
    if (!(await Tag.exists({ category: title }))) throw badRequest('That category does not exist')

    const { url } = await uploadImage(req.file, FOLDERS.explore)
    const card = await Card.create({ title, subtitle, image: url })
    res.status(201).json({ card })
}

export const fetchCards = async (req, res) => {
    res.status(200).json({ cards: await Card.find().sort({ createdAt: -1 }) })
}

export const removeCards = async (req, res) => {
    const card = await Card.findByIdAndDelete(requireObjectId(req.body?.cardId, 'card id'))
    if (!card) throw notFound('Card not found')
    res.status(200).json({ message: 'Card removed' })
}

export const addCategory = async (req, res) => {
    const category = cleanString((req.body?.values ?? req.body)?.category, 60)
    if (!category) throw badRequest('Category name is required')
    if (await Tag.exists({ category })) throw conflict('That category already exists')
    res.status(201).json({ category: await Tag.create({ category, tags: [] }) })
}

export const fetchCat = async (req, res) => {
    res.status(200).json({ categories: await Tag.find().sort({ category: 1 }) })
}

export const settags = async (req, res) => {
    const tag = cleanString(req.body?.tag, 41)
    const categoryId = requireObjectId(req.body?.category, 'category')
    if (!TAG_PATTERN.test(tag)) {
        throw badRequest("Tags start with '#' and use only letters, numbers or underscores")
    }
    const category = await Tag.findByIdAndUpdate(categoryId, { $addToSet: { tags: tag } }, { new: true })
    if (!category) throw notFound('Category not found')
    res.status(200).json({ category })
}

export const fetchTagsFromCard = async (req, res) => {
    const category = cleanString(req.body?.cat, 60)
    if (!category) throw badRequest('Category is required')
    const page = parsePagination(req.body ?? {})
    const { posts, hasMore } = await postsForCategoryServ(category, req.user._id, page)
    res.status(200).json({ posts, page: page.page, hasMore })
}

export const adminStrike = async (req, res) => {
    const postId = requireObjectId(req.body?.postId, 'post id')
    const post = await Post.findById(postId, 'adminStrike')
    if (!post) throw notFound('Post not found')
    const striked = !post.adminStrike
    await Post.updateOne({ _id: postId }, { adminStrike: striked })
    res.status(200).json({ striked, message: striked ? 'Post struck' : 'Strike removed' })
}

export const fetchActions = async (req, res) => {
    const userId = requireObjectId(req.query.userId, 'user id')
    const postId = requireObjectId(req.query.postId, 'post id')
    const [post, user] = await Promise.all([Post.findById(postId, 'adminStrike'), User.findById(userId, 'adminblock')])
    res.status(200).json({ isBlock: Boolean(user?.adminblock), isStrike: Boolean(post?.adminStrike) })
}
