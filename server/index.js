import cors from 'cors';
import express from 'express';
import { collections, KNIFE_TYPES, GLOVE_TYPES } from './data/index.js';

const app = express();
const PORT = process.env.PORT || 3001;
const PRICE_CACHE_TTL = 5 * 60 * 1000;
const PRICE_CONCURRENCY = 6;
const INVENTORY_PAGE_SIZE = 2000;
const priceCache = new Map();

app.use(cors());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

// Steam image helper
function getSteamImageUrl(weapon, skin) {
  const hashName = skin === 'Default' || skin === 'Vanilla'
    ? weapon
    : `${weapon} | ${skin} (Factory New)`;
  return `https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulRPQV6CF7b9mNvbRGJ8/360fx360f`;
}

function getMarketImageUrl(weapon, skin) {
  const name = skin === 'Default' || skin === 'Vanilla'
    ? encodeURIComponent(weapon)
    : encodeURIComponent(`${weapon} | ${skin} (Factory New)`);
  return `/api/steam-image?name=${name}`;
}

// Collections API
app.get('/api/collections', (_request, response) => {
  const summary = collections.map(({ id, name, itemCount, containers, priceRange, released, knife, glove, items }) => ({
    id, name, itemCount, containers, priceRange, released, knife, glove,
    firstItem: items[0] || null
  }));
  response.json(summary);
});

app.get('/api/collections/:id', (request, response) => {
  const col = collections.find(c => c.id === request.params.id);
  if (!col) return response.status(404).json({ error: 'Collection not found' });
  // Add image URLs to items
  const items = col.items.map(item => ({
    ...item,
    image: getMarketImageUrl(item.weapon, item.skin)
  }));
  response.json({ ...col, items });
});

app.get('/api/knives', (_request, response) => {
  response.json({ types: KNIFE_TYPES, gloves: GLOVE_TYPES });
});

// Proxy Steam market images with rate limiting
const imageCache = new Map();
let lastFetch = 0;
const FETCH_DELAY = 1200; // ms between requests to avoid rate limit
const pendingRequests = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (pendingRequests.length > 0) {
    const { name, resolve } = pendingRequests.shift();
    const cached = imageCache.get(name);
    if (cached !== undefined) { resolve(cached); continue; }

    const wait = Math.max(0, FETCH_DELAY - (Date.now() - lastFetch));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFetch = Date.now();

    try {
      const url = `https://steamcommunity.com/market/search/render/?query=${encodeURIComponent(name)}&appid=730&norender=1&count=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (res.ok) {
        const data = await res.json();
        const item = data.results?.[0];
        if (item?.asset_description?.icon_url) {
          const img = `https://community.cloudflare.steamstatic.com/economy/image/${item.asset_description.icon_url}/360fx360f`;
          imageCache.set(name, img);
          resolve(img);
          continue;
        }
      }
      if (res.status === 429) {
        // Rate limited - wait longer and retry
        await new Promise(r => setTimeout(r, 5000));
        pendingRequests.unshift({ name, resolve });
        continue;
      }
    } catch {}
    imageCache.set(name, '');
    resolve('');
  }
  processing = false;
}

app.get('/api/steam-image', async (request, response) => {
  const name = request.query.name;
  if (!name) return response.status(400).json({ error: 'name required' });

  const cached = imageCache.get(name);
  if (cached !== undefined) return response.json({ image: cached });

  const image = await new Promise(resolve => {
    pendingRequests.push({ name, resolve });
    processQueue();
  });
  response.json({ image });
});

// Get price for a skin by market_hash_name
app.get('/api/price', async (request, response) => {
  const name = request.query.name;
  if (!name) return response.status(400).json({ error: 'name required' });

  const cacheKey = `price_${name}`;
  const cached = priceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return response.json({ price: cached.value });
  }

  // Wait for queue (rate limit)
  const price = await new Promise(resolve => {
    pendingRequests.push({ name: `__price__${name}`, resolve: async (img) => {
      // This won't work in queue, do inline
      resolve(0);
    }});
  });

  response.json({ price });
});

// Separate price fetcher using search API
app.get('/api/skin-price', async (request, response) => {
  const name = request.query.name;
  if (!name) return response.status(400).json({ error: 'name required' });

  const cacheKey = `price_${name}`;
  const cached = priceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return response.json({ price: cached.value });
  }

  try {
    const url = `https://steamcommunity.com/market/search/render/?query=${encodeURIComponent(name)}&appid=730&norender=1&count=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (res.ok) {
      const data = await res.json();
      const item = data.results?.[0];
      if (item) {
        const priceText = item.sell_price_text || '';
        const val = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
        priceCache.set(cacheKey, { value: val, expiresAt: Date.now() + PRICE_CACHE_TTL });
        return response.json({ price: val });
      }
    }
  } catch {}
  response.json({ price: 0 });
});

app.get('/api/inventory/:profileId', async (request, response) => {
  const profileId = request.params.profileId?.trim();

  if (!/^\d{17}$/.test(profileId)) {
    response.status(400).json({ error: 'SteamID64 formatinda 17 haneli bir profil ID gir.' });
    return;
  }

  try {
    const [inventory, profile] = await Promise.all([
      fetchInventory(profileId),
      fetchProfile(profileId),
    ]);
    const items = await attachPrices(inventory.items);

    response.json({
      total: items.length,
      steamTotal: inventory.steamTotal,
      totalQuantity: inventory.totalQuantity,
      fetchedAt: new Date().toLocaleString('tr-TR'),
      profile,
      items,
    });
  } catch (error) {
    response.status(502).json({
      error: error.message || 'Steam envanteri cekilirken bir hata olustu.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Steam backend listening on http://localhost:${PORT}`);
});

async function fetchInventory(profileId) {
  const descriptionMap = new Map();
  const assets = [];
  let steamTotal = null;
  let moreItems = true;
  let lastAssetId = null;

  while (moreItems) {
    const payload = await fetchInventoryPage(profileId, lastAssetId);
    steamTotal = payload.total_inventory_count ?? steamTotal;

    for (const description of payload.descriptions || []) {
      descriptionMap.set(`${description.classid}_${description.instanceid}`, description);
    }

    for (const asset of payload.assets || []) {
      assets.push(asset);
    }

    moreItems = Boolean(payload.more_items);
    lastAssetId = payload.last_assetid || null;

    if (moreItems && !lastAssetId) {
      break;
    }
  }

  const items = assets
    .map((asset) => {
      const description = descriptionMap.get(`${asset.classid}_${asset.instanceid}`);
      return mapItem(asset, description);
    })
    .filter(Boolean);

  return {
    items,
    steamTotal,
    totalQuantity: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

async function fetchInventoryPage(profileId, startAssetId) {
  const params = new URLSearchParams({
    l: 'english',
    count: String(INVENTORY_PAGE_SIZE),
  });

  if (startAssetId) {
    params.set('start_assetid', startAssetId);
  }

  const inventoryUrl = `https://steamcommunity.com/inventory/${profileId}/730/2?${params.toString()}`;
  const inventoryResponse = await fetch(inventoryUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'steam-project-inventory-viewer',
    },
  });

  if (!inventoryResponse.ok) {
    if (inventoryResponse.status === 401 || inventoryResponse.status === 403) {
      throw new Error('Steam inventory private veya erisime kapali. Profilin ve envanterin public olmali.');
    }

    throw new Error(`Steam inventory su anda alinmiyor. Steam status: ${inventoryResponse.status}`);
  }

  return inventoryResponse.json();
}

async function fetchProfile(profileId) {
  const url = `https://steamcommunity.com/profiles/${profileId}?xml=1`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/xml,text/xml',
      'User-Agent': 'steam-project-profile-fetcher',
    },
  });

  if (!response.ok) {
    return {
      steamId64: profileId,
      name: profileId,
      avatar: '',
    };
  }

  const xml = await response.text();
  const name = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/)?.[1]?.trim()
    || xml.match(/<steamID>(.*?)<\/steamID>/)?.[1]?.trim()
    || profileId;
  const avatar = xml.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/)?.[1]?.trim()
    || xml.match(/<avatarFull>(.*?)<\/avatarFull>/)?.[1]?.trim()
    || '';

  return {
    steamId64: profileId,
    name,
    avatar,
  };
}

async function attachPrices(items) {
  const uniqueNames = [
    ...new Set(
      items
        .filter((item) => item.marketable)
        .map((item) => item.marketHashName || item.name)
        .filter(Boolean),
    ),
  ];

  const priceEntries = await mapWithConcurrency(uniqueNames, PRICE_CONCURRENCY, async (name) => {
    const priceData = await fetchPrice(name);
    return [name, priceData];
  });

  const priceMap = new Map(priceEntries);

  return items.map((item, index) => {
    const lookupKey = item.marketHashName || item.name;
    const priceData = item.marketable
      ? priceMap.get(lookupKey) || {
          price: null,
          priceValue: null,
          netPrice: null,
          netPriceValue: null,
          priceSource: 'unavailable',
        }
      : {
          price: null,
          priceValue: null,
          netPrice: null,
          netPriceValue: null,
          priceSource: 'unmarketable',
        };

    return {
      ...item,
      ...priceData,
      assetId: `${item.assetId}-${index}`,
    };
  });
}

function mapItem(asset, description) {
  if (!description) {
    return {
      assetId: asset.assetid,
      amount: Number.parseInt(asset.amount || '1', 10) || 1,
      name: `Unknown item ${asset.classid}`,
      marketHashName: '',
      image: '',
      rarity: 'Item',
      rarityRank: 0,
      collection: 'Unresolved description',
      exterior: 'Inspect needed',
      nameColor: null,
      marketable: false,
      stickers: [],
      charms: [],
    };
  }

  const tags = Array.isArray(description.tags) ? description.tags : [];
  const attachments = extractAttachments(description);
  const rarity = getTagName(tags, 'Rarity') || getTagName(tags, 'Quality') || 'Item';

  return {
    assetId: asset.assetid,
    amount: Number.parseInt(asset.amount || '1', 10) || 1,
    name: description.market_name || description.name,
    marketHashName: description.market_hash_name || description.market_name || description.name,
    image: description.icon_url
      ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}/360fx360f`
      : '',
    rarity,
    rarityRank: getRarityRank(rarity),
    collection: getCollectionName(tags) || 'CS2 Item',
    exterior: getTagName(tags, 'Exterior') || getTagName(tags, 'Weapon') || 'Inspect needed',
    nameColor: description.name_color ? `#${description.name_color}` : null,
    marketable: description.marketable === 1,
    stickers: attachments.stickers,
    charms: attachments.charms,
  };
}

function extractAttachments(description) {
  const sources = [
    ...(Array.isArray(description.descriptions) ? description.descriptions : []),
    ...(Array.isArray(description.owner_descriptions) ? description.owner_descriptions : []),
    ...(Array.isArray(description.fraudwarnings) ? description.fraudwarnings : []),
  ];

  const attachments = {
    stickers: [],
    charms: [],
  };

  for (const source of sources) {
    const rawValue = typeof source === 'string' ? source : source?.value || '';
    if (!rawValue) {
      continue;
    }

    const plainValue = stripHtml(rawValue);
    const imageMatches = extractImageTags(rawValue);

    if (/sticker/i.test(plainValue)) {
      pushAttachments(attachments.stickers, imageMatches, 'Sticker');
      if (!imageMatches.length) {
        pushTextAttachments(attachments.stickers, plainValue, /stickers?:\s*(.+)$/i, 'Sticker');
      }
    }

    if (/charm/i.test(plainValue)) {
      pushAttachments(attachments.charms, imageMatches, 'Charm');
      if (!imageMatches.length) {
        pushTextAttachments(attachments.charms, plainValue, /charms?:\s*(.+)$/i, 'Charm');
      }
    }
  }

  return {
    stickers: attachments.stickers,
    charms: attachments.charms,
  };
}

function extractImageTags(value) {
  const imgTags = [...value.matchAll(/<img[^>]*>/gi)].map((match) => match[0]);
  return imgTags.map((tag) => {
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1] || tag.match(/data-src=["']([^"']+)["']/i)?.[1] || '';
    const label = tag.match(/title=["']([^"']+)["']/i)?.[1] || tag.match(/alt=["']([^"']+)["']/i)?.[1] || '';
    return { src, label };
  });
}

function pushAttachments(target, imageMatches, typeLabel) {
  for (const match of imageMatches) {
    target.push({
      name: normalizeAttachmentName(match.label, typeLabel),
      image: normalizeAttachmentUrl(match.src),
      type: typeLabel.toLowerCase(),
    });
  }
}

function pushTextAttachments(target, text, pattern, typeLabel) {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return;
  }

  const values = match[1]
    .split(/,/)
    .map((value) => normalizeAttachmentName(value, typeLabel))
    .filter(Boolean);

  for (const value of values) {
    target.push({
      name: value,
      image: '',
      type: typeLabel.toLowerCase(),
    });
  }
}

function normalizeAttachmentName(value, typeLabel) {
  return stripHtml(value)
    .replace(new RegExp(`^${typeLabel}s?:`, 'i'), '')
    .replace(/\(1\)|\(2\)|\(3\)|\(4\)|\(5\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAttachmentUrl(url) {
  if (!url) {
    return '';
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  if (url.startsWith('/')) {
    return `https://steamcommunity.com${url}`;
  }

  return url;
}

function stripHtml(value) {
  return value.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
}

function getTagName(tags, category) {
  return tags.find((tag) => tag.category === category)?.localized_tag_name || '';
}

function getCollectionName(tags) {
  return tags.find((tag) => tag.category === 'ItemSet' || tag.localized_category_name === 'Collection')?.localized_tag_name || '';
}

function getRarityRank(rarity) {
  const normalized = rarity.toLowerCase();

  if (normalized.includes('contraband')) return 8;
  if (normalized.includes('extraordinary')) return 7;
  if (normalized.includes('covert')) return 6;
  if (normalized.includes('classified')) return 5;
  if (normalized.includes('restricted')) return 4;
  if (normalized.includes('mil-spec')) return 3;
  if (normalized.includes('industrial')) return 2;
  if (normalized.includes('consumer')) return 1;
  return 0;
}

async function fetchPrice(name) {
  const cached = priceCache.get(name);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const sources = [fetchPriceOverview, fetchMarketSearchPrice, fetchListingPrice];

  for (const source of sources) {
    const result = await source(name);
    if (result?.price) {
      priceCache.set(name, {
        value: result,
        expiresAt: Date.now() + PRICE_CACHE_TTL,
      });
      return result;
    }
  }

  const unavailable = {
    price: null,
    priceValue: null,
    netPrice: null,
    netPriceValue: null,
    priceSource: 'unavailable',
  };

  priceCache.set(name, {
    value: unavailable,
    expiresAt: Date.now() + PRICE_CACHE_TTL,
  });

  return unavailable;
}

async function fetchPriceOverview(name) {
  const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'steam-project-price-fetcher',
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const price = payload?.lowest_price || payload?.median_price || null;

  if (!price) {
    return null;
  }

  return {
    price,
    priceValue: parsePriceValue(price),
    netPrice: formatUsd(estimateNetPrice(parsePriceValue(price))),
    netPriceValue: estimateNetPrice(parsePriceValue(price)),
    priceSource: 'priceoverview',
  };
}

async function fetchMarketSearchPrice(name) {
  const url = `https://steamcommunity.com/market/search/render/?query=${encodeURIComponent(name)}&appid=730&norender=1&count=20&search_descriptions=0`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'steam-project-market-search-fetcher',
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];
  const exact = results.find((result) => {
    const candidate = result.hash_name || result.name || '';
    return candidate.toLowerCase() === name.toLowerCase();
  });

  if (!exact) {
    return null;
  }

  const price = exact.sale_price_text || exact.sell_price_text || null;
  const grossPrice = exact.sell_price_text || price;
  const netPrice = exact.sale_price_text || formatUsd(estimateNetPrice(parsePriceValue(grossPrice)));

  if (!price) {
    return null;
  }

  return {
    price: grossPrice,
    priceValue: parsePriceValue(grossPrice),
    netPrice,
    netPriceValue: parsePriceValue(netPrice),
    priceSource: 'search',
  };
}

async function fetchListingPrice(name) {
  const url = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'steam-project-listing-fetcher',
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const candidates = [
    ...html.matchAll(/Starting at:\s*<span[^>]*>([^<]+)<\/span>/gi),
    ...html.matchAll(/median_price[^\d$€£]*([\$€£]\s?[\d.,]+)/gi),
    ...html.matchAll(/lowest_price[^\d$€£]*([\$€£]\s?[\d.,]+)/gi),
  ];

  for (const candidate of candidates) {
    const price = candidate[1]?.trim();
    const priceValue = parsePriceValue(price);
    if (price && priceValue !== null) {
      return {
        price,
        priceValue,
        netPrice: formatUsd(estimateNetPrice(priceValue)),
        netPriceValue: estimateNetPrice(priceValue),
        priceSource: 'listings',
      };
    }
  }

  return null;
}

function parsePriceValue(price) {
  if (!price) {
    return null;
  }

  const numeric = price.replace(/[^\d.,]/g, '');
  if (!numeric) {
    return null;
  }

  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  let normalized = numeric;

  if (lastComma > lastDot) {
    normalized = numeric.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = numeric.replace(/,/g, '');
  } else {
    normalized = numeric.replace(',', '.');
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function estimateNetPrice(priceValue) {
  if (!Number.isFinite(priceValue)) {
    return null;
  }
  // Steam fee: floor(price * 0.05), min $0.01
  // CS2 game fee: floor(price * 0.10), min $0.01
  const steamFee = Math.max(0.01, Math.floor(priceValue * 0.05 * 100) / 100);
  const gameFee = Math.max(0.01, Math.floor(priceValue * 0.10 * 100) / 100);
  return Number((priceValue - steamFee - gameFee).toFixed(2));
}

function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = [];
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (currentIndex < values.length) {
      const value = values[currentIndex];
      currentIndex += 1;
      results.push(await mapper(value));
    }
  });

  await Promise.all(workers);
  return results;
}
