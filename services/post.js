import Post from '../schema/postSchema.js'
import Tag from '../schema/tagSchema.js';
import User from '../schema/userSchema.js';
import { escapeRegex, normalizeTags } from '../utils/validation.js';
import { profileImagesServ } from './user.js';

const AUTHOR_FIELDS = 'fullname adminblock'

// Authors whose posts a viewer must not see: admin-blocked accounts and users the viewer blocked.
const hiddenAuthorIds = async (viewerId) => {
    const users = await User.find({ $or: [{ adminblock: true }, { userblock: String(viewerId) }] }, '_id').lean()
    return users.map((u) => u._id)
}

// Query for posts that are publicly visible to `viewerId`.
// `$ne: true` (not `false`) so posts created before these fields existed are included.
export const visiblePostFilter = async (viewerId, extra = {}) => ({
    archive: { $ne: true },
    adminStrike: { $ne: true },
    interested: { $ne: String(viewerId) },
    userId: { $nin: await hiddenAuthorIds(viewerId) },
    ...extra,
})

// Adds the author's profile image as `userId.image` on populated posts.
export const withAuthorImages = async (posts) => {
    const list = Array.isArray(posts) ? posts : [posts]
    const authorIds = list.map((p) => p.userId?._id).filter(Boolean)
    const images = await profileImagesServ(authorIds)
    const result = list.map((p) => {
        const json = p.toJSON()
        if (json.userId?._id) json.userId.image = images.get(String(json.userId._id)) || null
        return json
    })
    return Array.isArray(posts) ? result : result[0]
}

const findPage = async (filter, { skip = 0, limit = 30, sort = { createdAt: -1, _id: -1 } } = {}) => {
    const docs = await Post.find(filter).sort(sort).skip(skip).limit(limit + 1).populate('userId', AUTHOR_FIELDS)
    const hasMore = docs.length > limit
    return { posts: await withAuthorImages(docs.slice(0, limit)), hasMore }
}

export const uploadPostServ = (post) => Post.create(post)

export const fetchFeedServ = async (viewerId, page) => findPage(await visiblePostFilter(viewerId), page)

export const servViewPost = (id) => Post.findById(id).populate('userId', AUTHOR_FIELDS)

export const fetchRelatedServ = async (post, viewerId, limit = 24) => {
    const tags = normalizeTags(post.tags)
    const filter = await visiblePostFilter(viewerId, { _id: { $ne: post._id } })
    if (tags.length) {
        filter.tags = { $in: tags.map((t) => new RegExp(escapeRegex(t), 'i')) }
    }
    const { posts } = await findPage(filter, { limit })
    return posts
}

// Posts on a profile. Owners also see their own struck posts (flagged in the UI).
export const fetchMyPostServ = async (authorId, { isOwner }) => {
    const filter = { userId: authorId, archive: { $ne: true } }
    if (!isOwner) filter.adminStrike = { $ne: true }
    const docs = await Post.find(filter).sort({ createdAt: -1 }).populate('userId', AUTHOR_FIELDS)
    return withAuthorImages(docs)
}

export const deletePostServ = (postId) => Post.findByIdAndDelete(postId)

export const updatePostServ = (postId, data) => Post.findByIdAndUpdate(postId, data, { new: true, runValidators: true })

//saved

export const toggleSaveServ = async (postId, userId) => {
    const isSaved = await Post.exists({ _id: postId, saved: String(userId) })
    const update = isSaved ? { $pull: { saved: String(userId) } } : { $addToSet: { saved: String(userId) } }
    await Post.updateOne({ _id: postId }, update)
    return !isSaved
}

export const fetchSavedPostsServ = async (userId) => {
    const filter = await visiblePostFilter(userId, { saved: String(userId) })
    const docs = await Post.find(filter).sort({ updatedAt: -1 }).populate('userId', AUTHOR_FIELDS)
    return withAuthorImages(docs)
}

//archive

export const setArchiveServ = (postId, archive) => Post.findByIdAndUpdate(postId, { archive }, { new: true })

export const fetchArchiveServ = async (userId) => {
    const docs = await Post.find({ archive: true, userId }).sort({ updatedAt: -1 }).populate('userId', AUTHOR_FIELDS)
    return withAuthorImages(docs)
}

// search

const SEARCH_FIELDS = { Title: 'postTitle', Tag: 'tags', Location: 'location' }

export const searchTermsServ = async (searchValue, select, viewerId) => {
    const pattern = new RegExp(escapeRegex(searchValue), 'i')

    if (select === 'User') {
        const hidden = await hiddenAuthorIds(viewerId)
        return User.find({ fullname: pattern, _id: { $nin: hidden }, role: { $ne: 'admin' } }, { _id: 1, fullname: 1 }).limit(8).lean()
    }

    const field = SEARCH_FIELDS[select]
    if (!field) return []
    const values = await Post.distinct(field, await visiblePostFilter(viewerId, { [field]: pattern }))
    const flat = field === 'tags' ? normalizeTags(values, 500) : values.filter(Boolean)
    return [...new Set(flat)].filter((v) => pattern.test(v)).slice(0, 8)
}

export const finalSearchServ = async (searchValue, select, viewerId, page) => {
    const field = SEARCH_FIELDS[select]
    if (!field) return { posts: [], hasMore: false }
    const filter = await visiblePostFilter(viewerId, { [field]: new RegExp(escapeRegex(searchValue), 'i') })
    return findPage(filter, page)
}

// not interested

export const notInterestedServ = (userId, postId) =>
    Post.updateOne({ _id: postId }, { $addToSet: { interested: String(userId) } })

export const fetchNotInterestedServ = async (userId) => {
    const docs = await Post.find({ archive: { $ne: true }, interested: String(userId) })
        .sort({ updatedAt: -1 })
        .populate('userId', AUTHOR_FIELDS)
    return withAuthorImages(docs)
}

export const removeNotInterestServ = (postId, userId) =>
    Post.updateOne({ _id: postId }, { $pull: { interested: String(userId) } })

// tags

export const applyTagServ = async (value) => {
    const pattern = new RegExp(escapeRegex(value), 'i')
    const docs = await Tag.find({ tags: pattern }, { tags: 1, _id: 0 }).lean()
    return [...new Set(docs.flatMap((d) => d.tags))].filter((t) => pattern.test(t)).slice(0, 10)
}

export const postsForCategoryServ = async (category, viewerId, page) => {
    const docs = await Tag.find({ category }).lean()
    const tags = docs.flatMap((d) => d.tags || [])
    if (!tags.length) return { posts: [], hasMore: false }
    const filter = await visiblePostFilter(viewerId, {
        tags: { $in: tags.map((t) => new RegExp(escapeRegex(t), 'i')) },
    })
    return findPage(filter, page)
}
