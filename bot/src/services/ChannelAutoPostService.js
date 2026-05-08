const ChannelAutoPost = require('../models/ChannelAutoPost');
const Channel = require('../models/Channel');
const Product = require('../models/Product');
const Review = require('../models/Review');

let started = false;

async function buildPostText(job) {
  if (job.postType === 'custom') return job.customText || '🎮 Mental Gaming Store';
  if (job.postType === 'about_bot') return '🎮 Mental Gaming Store\n\nGame credits, top-ups, gift cards တွေကို လွယ်လွယ်ကူကူ ဝယ်ယူနိုင်တဲ့ store bot ပါ။';
  if (job.postType === 'how_to_buy') return '🛒 ဘယ်လိုဝယ်မလဲ?\n\n1) Bot မှာ /start နှိပ်\n2) Shop ထဲဝင်\n3) Product ရွေး\n4) Wallet top-up / order confirm လုပ်ပါ။';
  if (job.postType === 'features') return '✨ Bot Features\n\n💰 Wallet\n🛒 Shop\n🎰 Spin rewards\n🗓 Daily check-in\n🎟 Coupons\n💬 AI Support\n📦 Order tracking';
  if (job.postType === 'daily_promo') return '🎁 Daily Promotion\n\nဒီနေ့ promotion တွေကို bot ထဲက Shop / Promo section မှာ စစ်ဆေးနိုင်ပါတယ်။';
  if (job.postType === 'top_products') {
    const products = await Product.find({ isActive: true }).sort({ totalSold: -1, createdAt: -1 }).limit(5).lean();
    const lines = products.map((p,i)=>`${i+1}. ${p.name} — ${(p.finalPrice||0).toLocaleString()} KS`).join('\n');
    return `🔥 Top Products\n\n${lines || 'No products yet.'}`;
  }
  if (job.postType === 'reviews') {
    const reviews = await Review.find({}).sort({ createdAt: -1 }).limit(3).lean().catch(()=>[]);
    const lines = reviews.map((r,i)=>`${i+1}. ⭐ ${r.rating || ''} ${r.comment || ''}`).join('\n');
    return `⭐ Customer Reviews\n\n${lines || 'Review channel မှာ customer feedback တွေကြည့်နိုင်ပါတယ်။'}`;
  }
  return '🎮 Mental Gaming Store';
}

function dueNow(job, now = new Date()) {
  const mmTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Rangoon' }));
  if (mmTime.getHours() !== job.hour || mmTime.getMinutes() !== job.minute) return false;
  if (!job.lastPostedAt) return true;
  const last = new Date(job.lastPostedAt);
  const diff = now - last;
  if (job.frequency === 'weekly') return diff > 6.5 * 86400000;
  return diff > 23 * 3600000;
}

function startChannelAutoPoster(telegram) {
  if (started) return;
  started = true;
  setInterval(async () => {
    try {
      const jobs = await ChannelAutoPost.find({ isActive: true }).populate('channelId').limit(50);
      for (const job of jobs) {
        const ch = job.channelId;
        if (!ch || !ch.isActive || !ch.autoPostEnabled) continue;
        if (!dueNow(job)) continue;
        const text = await buildPostText(job);
        await telegram.sendMessage(ch.channelId, text).catch(err => console.error('[AutoPost] send failed:', err.message));
        job.lastPostedAt = new Date();
        await job.save();
      }
    } catch (err) {
      console.error('[AutoPost] tick failed:', err.message);
    }
  }, 60_000);
  console.log('[Bot] ✅ Channel auto poster scheduled');
}

module.exports = { startChannelAutoPoster, buildPostText };
