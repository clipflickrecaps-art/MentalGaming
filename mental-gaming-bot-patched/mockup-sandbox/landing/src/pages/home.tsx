import { useEffect, useState } from "react";
import { 
  Gamepad2, 
  Zap, 
  ShieldCheck, 
  Gift, 
  ChevronRight, 
  Trophy, 
  Star,
  Send,
  MessageSquare,
  Clock,
  Sparkles,
  Ticket,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";

const BOT_URL = "https://t.me/MentalGamingStoreBot";

const GAMES = [
  { name: "Mobile Legends", type: "Diamonds", img: "/images/game-ml.png", color: "from-blue-500/80 to-purple-500/80", shadow: "shadow-blue-500/20" },
  { name: "Free Fire", type: "Gems", img: "/images/game-ff.png", color: "from-orange-500/80 to-red-500/80", shadow: "shadow-orange-500/20" },
  { name: "PUBG Mobile", type: "UC", img: "/images/game-pubg.png", color: "from-yellow-500/80 to-orange-500/80", shadow: "shadow-yellow-500/20" },
  { name: "Genshin Impact", type: "Crystals", img: "/images/game-genshin.png", color: "from-cyan-500/80 to-blue-500/80", shadow: "shadow-cyan-500/20" },
  { name: "Valorant", type: "VP", img: "/images/game-val.png", color: "from-red-500/80 to-rose-600/80", shadow: "shadow-red-500/20" },
  { name: "Gift Cards", type: "Multiple", img: "/images/game-cards.png", color: "from-emerald-500/80 to-teal-500/80", shadow: "shadow-emerald-500/20" }
];

const TIERS = [
  {
    name: "Silver",
    discount: "2% Off",
    perks: ["Standard Support", "Daily Check-in (1x)", "Basic Spin Wheel"],
    image: "/images/card-silver.png",
    glow: "shadow-gray-400/20",
    border: "border-gray-400/50"
  },
  {
    name: "Gold",
    discount: "5% Off",
    perks: ["Priority Support", "Daily Check-in (2x)", "Premium Spin Wheel", "Exclusive Promos"],
    image: "/images/card-gold.png",
    glow: "shadow-yellow-400/30",
    border: "border-yellow-400/50",
    featured: true
  },
  {
    name: "Platinum",
    discount: "10% Off",
    perks: ["24/7 VIP Support", "Daily Check-in (3x)", "VIP Spin Wheel", "Early Access", "Birthday Gift"],
    image: "/images/card-platinum.png",
    glow: "shadow-cyan-400/40",
    border: "border-cyan-400/50"
  }
];

export default function Home() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToGames = () => {
    document.getElementById('games')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-background/80 backdrop-blur-xl border-b border-white/10 py-3' : 'bg-transparent py-5'}`}>
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 font-black text-2xl tracking-tighter">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary neon-glow">
              <Gamepad2 className="w-6 h-6 text-white" />
            </div>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400">
              MENTAL<span className="text-primary ml-1">STORE</span>
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
            <a href="#games" className="hover:text-white transition-colors">Games</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#vip" className="hover:text-white transition-colors">VIP Tiers</a>
          </div>

          <Button 
            className="rounded-full font-bold shadow-[0_0_20px_rgba(217,70,239,0.4)] bg-primary hover:bg-primary/90 text-white border border-primary/50 transition-all hover:scale-105"
            onClick={() => window.open(BOT_URL, "_blank")}
          >
            <Send className="w-4 h-4 mr-2" /> Top Up Now
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[100dvh] flex items-center pt-20 pb-20 overflow-hidden">
        {/* Background Gradients & Images */}
        <div className="absolute inset-0 z-0">
          <img src="/images/hero-bg.png" alt="Gaming Arena" className="w-full h-full object-cover opacity-40 mix-blend-screen" />
          <div className="absolute inset-0 bg-grid-pattern opacity-20" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/20 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-secondary/20 rounded-full blur-[100px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
        </div>

        <div className="container relative z-10 mx-auto px-4 flex flex-col items-center text-center mt-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm font-semibold mb-8 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
            <span className="flex h-2 w-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse" />
            <span className="text-gray-300">Bot is Online • <span className="text-white">Fast Processing</span></span>
          </div>
          
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-6 animate-in fade-in slide-in-from-bottom-6 duration-700 leading-tight">
            <span className="block text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400">INSTANT GAME</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-secondary text-glow drop-shadow-[0_0_30px_rgba(217,70,239,0.3)]">TOP-UP BOT.</span>
          </h1>
          
          <p className="text-lg md:text-2xl text-gray-400 max-w-2xl mx-auto mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 font-medium">
            Myanmar's #1 automated Telegram store. No registration, no waiting. Secure your diamonds, UC, and VP in seconds.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 w-full sm:w-auto">
            <Button 
              size="lg" 
              className="w-full sm:w-auto text-lg h-16 px-10 rounded-full shadow-[0_0_30px_rgba(217,70,239,0.5)] bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-bold border border-primary/50 transition-all hover:scale-105"
              onClick={() => window.open(BOT_URL, "_blank")}
            >
              <Send className="w-6 h-6 mr-3" />
              Open Telegram Bot
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto text-lg h-16 px-10 rounded-full border-white/20 hover:bg-white/10 hover:border-white/40 font-semibold bg-white/5 backdrop-blur-sm transition-all"
              onClick={scrollToGames}
            >
              View Games
            </Button>
          </div>
          
          <div className="mt-24 animate-bounce text-white/30 cursor-pointer hover:text-white/70 transition-colors" onClick={scrollToGames}>
            <ChevronDown className="w-8 h-8" />
          </div>
        </div>
      </section>

      {/* Games Grid */}
      <section id="games" className="py-24 relative z-10 bg-black/40 border-y border-white/5">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-4 uppercase tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">Choose Your Arena</h2>
            <p className="text-xl text-gray-400">Automated top-ups delivered instantly to your UID.</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6">
            {GAMES.map((game, i) => (
              <div 
                key={i} 
                className={`group relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 bg-white/5 hover:border-white/30 transition-all duration-500 hover:-translate-y-2 cursor-pointer shadow-lg hover:${game.shadow}`}
                onClick={() => window.open(BOT_URL, "_blank")}
              >
                {/* Simulated Game Images using gradients for now since we didn't generate 6 specific game posters */}
                <div className={`absolute inset-0 bg-gradient-to-br ${game.color} opacity-40 group-hover:opacity-60 transition-opacity duration-500 z-10`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10" />
                <img src={game.img} alt={game.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 z-0" />
                
                <div className="absolute inset-0 p-4 flex flex-col justify-end z-20">
                  <div className="translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                    <h3 className="font-black text-lg md:text-xl leading-tight mb-1">{game.name}</h3>
                    <p className="text-sm font-semibold text-primary group-hover:text-secondary transition-colors">{game.type}</p>
                  </div>
                  <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <Button size="sm" className="w-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm border border-white/10 rounded-lg">
                      Top Up
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gamification & Features */}
      <section id="features" className="py-24 relative z-10 overflow-hidden">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px]" />
        
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-sm font-bold mb-6">
                <Sparkles className="w-4 h-4" /> MORE THAN A STORE
              </div>
              <h2 className="text-4xl md:text-5xl font-black mb-6 uppercase tracking-tight leading-tight">
                Play. Spin. <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-blue-500">Win Everyday.</span>
              </h2>
              <p className="text-xl text-gray-400 mb-10 leading-relaxed">
                Mental Store isn't just about buying — it's an ecosystem. Claim daily rewards, spin the lucky wheel, and use promo codes to get free diamonds and discounts.
              </p>
              
              <div className="space-y-6">
                {[
                  { icon: Gift, title: "Daily Check-in Bonuses", desc: "Open the bot daily to collect free store credits." },
                  { icon: Ticket, title: "Lucky Spin Wheel", desc: "Win up to 50% discount vouchers and free game passes." },
                  { icon: Zap, title: "Promo Codes", desc: "Watch our Telegram channel for flash promo drops." }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 p-4 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-white/5 flex flex-shrink-0 items-center justify-center border border-white/10 shadow-inner">
                      <item.icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold mb-1">{item.title}</h4>
                      <p className="text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-secondary/20 to-primary/20 blur-3xl rounded-full" />
              <div className="relative rounded-3xl border border-white/10 bg-black/50 backdrop-blur-xl p-8 shadow-2xl overflow-hidden">
                <div className="absolute inset-0 bg-grid-pattern opacity-10" />
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-48 h-48 rounded-full border-8 border-white/10 border-t-primary border-r-secondary animate-spin-slow flex items-center justify-center mb-8 relative shadow-[0_0_50px_rgba(217,70,239,0.2)]">
                    <div className="absolute inset-2 rounded-full border border-white/5 bg-black/80 flex items-center justify-center">
                      <Gift className="w-12 h-12 text-white animate-pulse" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tight mb-2">Spin to Win</h3>
                  <p className="text-gray-400 mb-6">Connect to Telegram to spin the wheel today!</p>
                  <Button className="w-full rounded-xl font-bold bg-white text-black hover:bg-gray-200">
                    Try Your Luck
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VIP Tiers */}
      <section id="vip" className="py-24 relative z-10 bg-black/60 border-y border-white/5">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-black mb-4 uppercase tracking-tight">Mental VIP Club</h2>
            <p className="text-xl text-gray-400">The more you top up, the higher you rank. Unlock permanent store-wide discounts and exclusive perks.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {TIERS.map((tier, i) => (
              <div 
                key={i} 
                className={`relative rounded-3xl border bg-black/40 backdrop-blur-sm p-1 transition-all duration-500 hover:-translate-y-2
                  ${tier.featured ? 'border-yellow-400/50 shadow-[0_0_30px_rgba(250,204,21,0.15)] md:-mt-8 md:mb-8' : 'border-white/10 hover:border-white/30'}
                `}
              >
                {tier.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-yellow-600 to-yellow-400 text-black text-xs font-black uppercase tracking-wider z-20">
                    Most Popular
                  </div>
                )}
                
                <div className="bg-background rounded-[1.35rem] h-full p-8 flex flex-col items-center text-center relative overflow-hidden">
                  <div className={`absolute top-0 inset-x-0 h-32 bg-gradient-to-b ${tier.glow} opacity-20 blur-2xl`} />
                  
                  {/* Card Image */}
                  <div className="w-48 h-48 mb-6 relative z-10 hover:scale-110 transition-transform duration-500">
                    <img src={tier.image} alt={`${tier.name} Card`} className="w-full h-full object-contain drop-shadow-2xl" />
                  </div>
                  
                  <h3 className="text-2xl font-black uppercase tracking-widest mb-2 z-10">{tier.name}</h3>
                  <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-8 z-10">
                    {tier.discount}
                  </div>
                  
                  <div className="w-full space-y-4 mb-8 z-10 flex-1">
                    {tier.perks.map((perk, j) => (
                      <div key={j} className="flex items-center justify-center gap-2 text-sm font-medium text-gray-300">
                        <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span>{perk}</span>
                      </div>
                    ))}
                  </div>
                  
                  <Button 
                    variant={tier.featured ? "default" : "outline"}
                    className={`w-full rounded-xl font-bold z-10 ${tier.featured ? 'bg-yellow-500 hover:bg-yellow-400 text-black' : 'border-white/20 hover:bg-white/10'}`}
                  >
                    View Details
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Security */}
      <section className="py-24 relative z-10">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-16 uppercase tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">Why Gamers Trust Us</h2>
          
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { icon: Zap, title: "1-Second Delivery", desc: "API integrated directly with official publishers." },
              { icon: ShieldCheck, title: "100% Legal", desc: "No refund tricks, no account bans. Ever." },
              { icon: MessageSquare, title: "AI + Human Help", desc: "Bot handles basics, admins handle the rest." },
              { icon: Trophy, title: "Myanmar's Best", desc: "Used by thousands of players every day." },
            ].map((feat, i) => (
              <div key={i} className="flex flex-col items-center text-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 shadow-inner text-white">
                  <feat.icon className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold mb-2">{feat.title}</h3>
                <p className="text-gray-400 text-sm">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 relative z-10 border-t border-white/10">
        <div className="container mx-auto px-4">
          <div className="rounded-[3rem] bg-gradient-to-br from-primary/20 via-background to-secondary/20 border border-white/10 p-8 md:p-20 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-pattern opacity-30 mix-blend-overlay" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
            
            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-5xl md:text-7xl font-black mb-6 tracking-tighter uppercase">Ready to Dominate?</h2>
              <p className="text-xl text-gray-300 mb-10 font-medium">
                Stop waiting for slow sellers. Tap the button below to open Telegram and get your credits instantly.
              </p>
              <Button 
                size="lg" 
                className="text-xl h-20 px-12 rounded-full shadow-[0_0_40px_rgba(217,70,239,0.5)] bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-black uppercase tracking-wider border border-primary/50 transition-all hover:scale-105"
                onClick={() => window.open(BOT_URL, "_blank")}
              >
                <Send className="w-7 h-7 mr-3" />
                START BOT NOW
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/5 bg-black/80">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2 font-black text-xl tracking-tighter">
              <Gamepad2 className="w-5 h-5 text-primary" />
              <span className="text-white">MENTAL<span className="text-gray-500">STORE</span></span>
            </div>
            
            <div className="flex gap-6 text-sm font-medium text-gray-500">
              <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">FAQ</a>
            </div>
            
            <p className="text-sm text-gray-600 font-medium">
              © {new Date().getFullYear()} Mental Gaming Store. Myanmar.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
