// One-off migration: rewrite post tags stored as JSON strings or comma-joined
// strings into clean arrays. The API already normalizes tags when it reads them,
// so this is optional cleanup.
//
//   npm run migrate:tags            -> dry run, shows what would change
//   npm run migrate:tags -- --apply -> writes the changes
import 'dotenv/config';
import mongoose from 'mongoose';
import { normalizeTags } from '../utils/validation.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGODB);
const posts = mongoose.connection.db.collection('posts');

let changed = 0;
for await (const post of posts.find({}, { projection: { tags: 1 } })) {
  const clean = normalizeTags(post.tags);
  if (JSON.stringify(clean) === JSON.stringify(post.tags ?? [])) continue;
  changed += 1;
  console.log(`${post._id}: ${JSON.stringify(post.tags)} -> ${JSON.stringify(clean)}`);
  if (apply) await posts.updateOne({ _id: post._id }, { $set: { tags: clean } });
}

console.log(`\n${changed} post(s) ${apply ? 'updated' : 'would be updated (dry run, pass --apply to write)'}.`);
await mongoose.disconnect();
