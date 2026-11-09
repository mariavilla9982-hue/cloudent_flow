const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherAccountId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env = {
  SUPABASE_URL: 'https://cloudent.test',
  CLOUDENT_X_BUFFER_CHANNELS: JSON.stringify({ [accountId]: 'buffer-channel' }),
  CLOUDENT_X_BUFFER_API_KEY: 'test-key',
};
const context = vm.createContext({
  URL, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder,
  Deno: { env: { get: key => env[key] }, serve() {} },
  twitterText: {
    parseTweet: text => ({ valid: text.length > 0 }),
    extractUrlsWithIndices: text => Array.from(text.matchAll(/https:\/\/[^\s]+/g), match => ({
      url: match[0], indices: [match.index, match.index + match[0].length],
    })),
  },
});
const worker = fs.readFileSync('supabase/functions/cloudent-x-publish-worker/index.ts', 'utf8');
vm.runInContext(stripTypeScriptTypes(worker).replace(/^import .*;\n/gm, ''), context);
const config = { platform_account_id: accountId };
const account = { id: accountId, enabled: true, config: { status: 'connected', username: 'ReisTest' } };
const file = {
  id: postId, user_id: 'test-user', platform_account_id: accountId,
  status: 'queued', post_text: 'Caption', reply_text: 'Link https://example.test/dest',
  meta: { source: 'upload', storage_provider: 'r2', storage_path: 'test-user/x-uploads/file.mp4' },
};
let paidCalls = 0;
let creates = 0;
let connection = 'reistest';
let remoteState = 'buffer';
const updates = [];
const admin = {
  from(table) {
    const filters = {};
    let patch;
    const query = {
      select: () => query,
      insert: async () => ({}),
      update: fields => { patch = fields; return query; },
      eq: (key, value) => { filters[key] = value; return query; },
      is: (key, value) => query.eq(key, value),
      maybeSingle: async () => ({ data: await query.then(value => value.data[0] ?? null) }),
      then(done) {
        if (table !== 'x_drive_posts') return Promise.resolve(done({ data: [] }));
        const matches = Object.entries(filters).every(([key, value]) => file[key] === value);
        if (matches && patch) Object.assign(file, structuredClone(patch));
        return Promise.resolve(done({ data: matches ? [structuredClone(file)] : [] }));
      },
    };
    return query;
  },
  async rpc(name, args) {
    if (name === 'claim_x_account_post') {
      if (file.status !== 'queued') return { data: null };
      Object.assign(file, { status: 'processing', locked_by: args.p_worker, attempts: 1 });
      return { data: structuredClone(file) };
    }
    if (name === 'complete_x_upload_post') {
      assert.equal(file.locked_by, args.p_worker_id);
      assert.equal(args.p_post_id, '12345');
      Object.assign(file, { status: 'published', x_post_id: args.p_post_id, reply_status: 'pending' });
      return {};
    }
    if (name === 'x_buffer_follow_link') {
      updates.push(args.p_count);
      return { data: args.p_post_id === postId ? file.meta.buffer_click_target : null };
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
context.resolveXAccount = async () => account;
context.uploadReadUrl = async () => 'https://storage.test/video.mp4?signature=abc';
context.usableXToken = async () => { paidCalls++; throw Error('Paid X call'); };
context.fetch = async (url, options) => {
  assert.equal(url, 'https://api.buffer.com');
  const { query, variables } = JSON.parse(options.body);
  if (query.startsWith('query Channel')) {
    return Response.json({ data: { channel: { service: 'twitter', name: connection } } });
  }
  if (query.startsWith('mutation Send')) {
    creates++;
    assert.equal(variables.input.channelId, 'buffer-channel');
    assert.equal(variables.input.mode, 'shareNow');
    const [root, reply] = variables.input.metadata.twitter.thread;
    assert.equal(root.assets[0].video.url, 'https://storage.test/video.mp4?signature=abc');
    assert.equal(reply.text, 'Link https://cloudent.test/functions/v1/cloudent-x-publish-worker?action=link&id=' + postId);
    return Response.json({ data: { createPost: { post: { id: 'buffer-post' } } } });
  }
  if (query.startsWith('query Status')) {
    return Response.json({ data: { post: { id: 'buffer-post', status: remoteState, externalLink: 'https://x.com/ReisTest/status/12345' } } });
  }
  throw new Error('Unexpected Buffer operation');
};

(async () => {
  assert.equal(context.bufferChannelFor(otherAccountId), '');
  const run = () => context.publishOne(admin, file.user_id, config, '', 'worker');
  assert.equal((await run()).state, 'buffer_processing');
  assert.equal(file.meta.buffer_post_id, 'buffer-post');
  assert.equal((await run()).state, 'buffer_processing');
  assert.equal(creates, 1);
  remoteState = 'sent';
  assert.equal((await run()).state, 'published');
  assert.equal(file.reply_status, 'published');
  await context.publishReply(admin, { ...file, reply_status: 'pending' }, '');
  assert.equal(paidCalls, 0);
  assert.equal(await run(), null);
  const tracked = new URL('https://cloudent.test/?action=link&id=' + postId);
  assert.equal((await context.followBufferLink(admin, new Request(tracked, { headers: { 'User-Agent': 'Firefox' } }), tracked)).headers.get('location'), 'https://example.test/dest');
  await context.followBufferLink(admin, new Request(tracked, { headers: { 'User-Agent': 'Twitterbot' } }), tracked);
  await context.followBufferLink(admin, new Request(tracked, { method: 'HEAD' }), tracked);
  assert.deepEqual(updates, [true, false, false]);
  Object.assign(file, { status: 'queued', x_post_id: null });
  connection = 'wrong_handle';
  assert.equal((await run()).state, 'failed');
  assert.equal(creates, 1);
  delete env.CLOUDENT_X_BUFFER_API_KEY;
  await assert.rejects(run, /Conecte o Buffer/);
  assert.equal(paidCalls, 0);
  console.log('PASS Buffer account isolation, single dispatch, confirmation, tracked redirects, preview exclusion and no paid X fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
