const fetch = require("node-fetch")

// purge cache on production deploy
console.log(process.env)
if (process.env.CLOUDFLARE_KEY && process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {

    fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE}/purge_cache`,
     {body: JSON.stringify({purge_everything: true}), headers: [["Authorization", `Bearer ${process.env.CLOUDFLARE_KEY}`],["Content-Type", "application/json"]], method: "POST"})
        .then(r => r.text()).then(r => console.log("cache cleared:", r)).catch(e => console.log("cache clear failed", e.message, e))
}
