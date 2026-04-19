import { useState } from 'react';

const SORT_OPTIONS = [
  { value: 'price-desc', label: 'Pahali -> Ucuz' },
  { value: 'price-asc', label: 'Ucuz -> Pahali' },
  { value: 'rarity-desc', label: 'Nadirlik' },
];

function extractSteamId64(value) {
  const match = value.match(/\b\d{17}\b/);
  return match ? match[0] : value.trim();
}

function buildGroupKey(item) {
  return [
    item.marketHashName || item.name,
    item.collection,
    item.exterior,
    item.price || '',
    item.netPrice || '',
    item.stickers.map((sticker) => `${sticker.name}|${sticker.image}`).join(','),
    item.charms.map((charm) => `${charm.name}|${charm.image}`).join(','),
  ].join('::');
}

function groupInventoryItems(items) {
  const groups = new Map();

  for (const item of items) {
    const key = buildGroupKey(item);
    const ownedAmount = item.amount || 1;
    const current = groups.get(key);

    if (current) {
      current.ownedCount += ownedAmount;
      current.assetIds.push(item.assetId);
      continue;
    }

    groups.set(key, {
      ...item,
      groupKey: key,
      ownedCount: ownedAmount,
      assetIds: [item.assetId],
    });
  }

  return [...groups.values()];
}

function formatPrice(item) {
  if (item.priceSource === 'unmarketable') {
    return 'Market disi / fiyat yok';
  }

  if (item.price) {
    return item.price;
  }

  return 'Steam price unavailable';
}

function formatTotalValue(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.00';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function AttachmentSlots({ items }) {
  return (
    <div className="attachment-slots">
      {items.map((item, index) => (
        <span className="attachment-slot" key={`${item.name}-${index}`} title={item.name}>
          {item.image ? <img src={item.image} alt={item.name} loading="lazy" /> : <span>{item.name.slice(0, 2).toUpperCase()}</span>}
        </span>
      ))}
    </div>
  );
}

function App() {
  const [profileId, setProfileId] = useState('');
  const [inventory, setInventory] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('price-desc');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [selectedQuantities, setSelectedQuantities] = useState({});

  async function loadInventory(inputValue, { keepSelection = false } = {}) {
    const normalizedProfileId = extractSteamId64(inputValue);
    if (!normalizedProfileId) {
      throw new Error('SteamID64 veya profil linki gir.');
    }

    setProfileId(normalizedProfileId);

    const response = await fetch(`/api/inventory/${normalizedProfileId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Inventory could not be loaded.');
    }

    setInventory(data.items);
    setSelectedQuantities((current) => {
      if (!keepSelection) {
        return {};
      }

      const next = {};
      for (const group of groupInventoryItems(data.items)) {
        const currentQuantity = current[group.groupKey] || 0;
        if (currentQuantity > 0) {
          next[group.groupKey] = Math.min(currentQuantity, group.ownedCount);
        }
      }
      return next;
    });
    setMeta({
      total: data.total,
      steamTotal: data.steamTotal,
      totalQuantity: data.totalQuantity,
      fetchedAt: data.fetchedAt,
      profile: data.profile,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await loadInventory(profileId);
    } catch (requestError) {
      setInventory([]);
      setSelectedQuantities({});
      setMeta(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (!profileId.trim()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      await loadInventory(profileId, { keepSelection: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  function updateSelectedQuantity(groupKey, nextQuantity, maxQuantity) {
    setSelectedQuantities((current) => {
      const normalizedQuantity = Math.max(0, Math.min(nextQuantity, maxQuantity));
      if (normalizedQuantity === 0) {
        const { [groupKey]: _, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [groupKey]: normalizedQuantity,
      };
    });
  }

  function clearSelection() {
    setSelectedQuantities({});
  }

  const groupedInventory = groupInventoryItems(inventory);
  const rarityOptions = ['all', ...new Set(groupedInventory.map((item) => item.rarity).filter(Boolean))];

  const filteredInventory = groupedInventory.filter((item) => {
    if (rarityFilter === 'all') {
      return true;
    }

    return item.rarity === rarityFilter;
  });

  const visibleInventory = [...filteredInventory].sort((left, right) => {
    if (sortBy === 'price-desc') {
      if (left.priceValue === null) return 1;
      if (right.priceValue === null) return -1;
      return right.priceValue - left.priceValue;
    }

    if (sortBy === 'price-asc') {
      if (left.priceValue === null) return 1;
      if (right.priceValue === null) return -1;
      return left.priceValue - right.priceValue;
    }

    return (right.rarityRank || 0) - (left.rarityRank || 0);
  });

  const totalInventoryValue = groupedInventory.reduce((sum, item) => sum + ((item.priceValue || 0) * item.ownedCount), 0);
  const totalInventoryNet = groupedInventory.reduce((sum, item) => sum + ((item.netPriceValue || 0) * item.ownedCount), 0);
  const selectedItemCount = Object.values(selectedQuantities).reduce((sum, value) => sum + value, 0);
  const marketableItemCount = groupedInventory.reduce((sum, item) => sum + (item.marketable ? item.ownedCount : 0), 0);
  const unmarketableItemCount = groupedInventory.reduce((sum, item) => sum + (!item.marketable ? item.ownedCount : 0), 0);
  const selectedInventoryValue = groupedInventory.reduce(
    (sum, item) => sum + ((selectedQuantities[item.groupKey] || 0) * (item.priceValue || 0)),
    0,
  );
  const selectedInventoryNet = groupedInventory.reduce(
    (sum, item) => sum + ((selectedQuantities[item.groupKey] || 0) * (item.netPriceValue || 0)),
    0,
  );

  function selectAllVisible() {
    setSelectedQuantities((current) => {
      const next = { ...current };
      for (const item of visibleInventory) {
        next[item.groupKey] = item.ownedCount;
      }
      return next;
    });
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="profile-badge">
            {meta?.profile?.avatar ? (
              <img className="profile-avatar" src={meta.profile.avatar} alt={meta.profile.name} loading="lazy" />
            ) : (
              <div className="profile-avatar profile-avatar-placeholder">SP</div>
            )}
            <div>
              <p className="brand-label">Steam Profile</p>
              <strong className="brand-title">{meta?.profile?.name || 'Profil yuklenmedi'}</strong>
              {meta?.profile?.steamId64 ? <span className="profile-id">{meta.profile.steamId64}</span> : null}
            </div>
          </div>

          <nav className="menu-strip" aria-label="Main menu">
            <a className="menu-link is-active" href="/">
              Inventory
            </a>
            <span className="menu-link">Market</span>
            <span className="menu-link">Trade Up</span>
            <span className="menu-link">Watchlist</span>
          </nav>
        </div>
      </header>

      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy-block">
            <p className="eyebrow">CS2 Inventory Viewer</p>
            <h1>Steam envanterini tek ekranda takip et</h1>
            <p className="hero-copy">
              Public SteamID64 ya da profil linki gir. Itemlerini, varsa sticker ve charm detaylarini,
              market fiyatlarini ve satis sonrasi tahmini Steam bakiyeni ayni ekranda gor.
            </p>
          </div>

          <form className="search-form" onSubmit={handleSubmit}>
            <label htmlFor="profileId">SteamID64 / Profile Link</label>
            <div className="input-row">
              <input
                id="profileId"
                name="profileId"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                placeholder="7656119... veya steamcommunity.com/profiles/..."
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Yukleniyor' : 'Envanteri Getir'}
              </button>
              <button className="secondary-button" type="button" onClick={handleRefresh} disabled={loading || !profileId.trim()}>
                Yenile
              </button>
            </div>
          </form>

          <div className="hero-stats">
            <article className="stat-card">
              <span>Toplam envanter degeri</span>
              <strong>{formatTotalValue(totalInventoryValue)}</strong>
            </article>
            <article className="stat-card">
              <span>Steam fee kesildikten sonraki bakiye</span>
              <strong>{formatTotalValue(totalInventoryNet)}</strong>
            </article>
            <article className="stat-card">
              <span>Secilen item adedi</span>
              <strong>{selectedItemCount}</strong>
            </article>
            <article className="stat-card">
              <span>Secili toplam deger</span>
              <strong>{formatTotalValue(selectedInventoryValue)}</strong>
            </article>
            <article className="stat-card">
              <span>Secililer satilinca kalacak bakiye</span>
              <strong>{formatTotalValue(selectedInventoryNet)}</strong>
            </article>
          </div>

          <div className="status-row">
            <span>
              {meta
                ? `${meta.total} asset cekildi${meta.steamTotal ? ` / Steam sayaci ${meta.steamTotal}` : ''}`
                : 'Public SteamID64 gerekli'}
            </span>
            <span>{meta?.totalQuantity ? `Toplam quantity ${meta.totalQuantity}` : 'Henuz inventory yuklenmedi'}</span>
          </div>

          <div className="summary-strip">
            <span className="summary-pill">Gruplanmis kart: {groupedInventory.length}</span>
            <span className="summary-pill">Marketable adet: {marketableItemCount}</span>
            <span className="summary-pill">Market disi adet: {unmarketableItemCount}</span>
          </div>

          {selectedItemCount > 0 ? (
            <div className="selection-highlight">
              <strong>{selectedItemCount} item secildi</strong>
              <span>Secili toplam: {formatTotalValue(selectedInventoryValue)}</span>
              <span>Fee sonrasi: {formatTotalValue(selectedInventoryNet)}</span>
            </div>
          ) : null}

          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <section className="inventory-panel">
          <div className="panel-header">
            <div className="panel-title-block">
              <p className="eyebrow">Inventory Grid</p>
              <h2>Itemler</h2>
            </div>

            <div className="toolbar-group">
              <label className="toolbar-field">
                <span>Sirala</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toolbar-field">
                <span>Filtre</span>
                <select value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}>
                  {rarityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === 'all' ? 'Tum nadirlikler' : option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="panel-meta-row">
            <span>{visibleInventory.length} farkli item gorunuyor</span>
            <div className="panel-actions">
              <button className="small-action" type="button" onClick={selectAllVisible} disabled={!visibleInventory.length}>
                Gorunenleri sec
              </button>
              <button className="small-action" type="button" onClick={clearSelection} disabled={!selectedItemCount}>
                Secimi temizle
              </button>
              {meta ? <span>Son guncelleme: {meta.fetchedAt}</span> : null}
            </div>
          </div>

          <div className="inventory-grid">
            {visibleInventory.map((item) => {
              const selectedQuantity = selectedQuantities[item.groupKey] || 0;
              const isSelected = selectedQuantity > 0;
              const hasAttachments = item.stickers.length > 0 || item.charms.length > 0;

              return (
                <article className={`item-card${isSelected ? ' is-selected' : ''}`} key={item.groupKey}>
                  <div className="item-card-topbar">
                    <span className={`item-checkbox${isSelected ? ' is-selected' : ''}`}>
                      {selectedQuantity}/{item.ownedCount}
                    </span>
                    <span className="item-amount">Owned x{item.ownedCount}</span>
                  </div>

                  <div className="item-media">
                    <img src={item.image} alt={item.name} loading="lazy" />
                  </div>

                  {hasAttachments ? (
                    <div className="attachments-block">
                      {item.stickers.length > 0 ? (
                        <div className="attachment-strip">
                          <span className="attachment-label">Stickers</span>
                          <AttachmentSlots items={item.stickers} />
                        </div>
                      ) : null}

                      {item.charms.length > 0 ? (
                        <div className="attachment-strip">
                          <span className="attachment-label">Charms</span>
                          <AttachmentSlots items={item.charms} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="item-details">
                    <span className="item-rarity" style={{ color: item.nameColor || '#9fb4c9' }}>
                      {item.rarity}
                    </span>
                    <h3>{item.name}</h3>
                    <p>{item.collection}</p>

                    <div className="item-footer">
                      <span>{item.exterior}</span>
                      <strong>{formatPrice(item)}</strong>
                    </div>

                    {item.netPrice ? <span className="price-source">Sana kalacak: {item.netPrice}</span> : null}

                    <div className="quantity-picker">
                      <button
                        type="button"
                        className="quantity-button"
                        onClick={() => updateSelectedQuantity(item.groupKey, selectedQuantity - 1, item.ownedCount)}
                        disabled={selectedQuantity === 0}
                      >
                        -
                      </button>
                      <span className="quantity-value">{selectedQuantity}</span>
                      <button
                        type="button"
                        className="quantity-button"
                        onClick={() => updateSelectedQuantity(item.groupKey, selectedQuantity + 1, item.ownedCount)}
                        disabled={selectedQuantity >= item.ownedCount}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && visibleInventory.length === 0 ? (
              <div className="empty-state">
                <h3>Inventory bekleniyor</h3>
                <p>Public bir SteamID64 girip envanteri yukleyebilirsin. Private profiller Steam tarafinda donmez.</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <p className="footer-title">Steam Project</p>
            <p className="footer-copy">CS2 inventory analysis, grouped valuation, collection tracking and liquidation planning.</p>
          </div>

          <div className="footer-links" aria-label="Footer links">
            <span>Inventory</span>
            <span>Sell Planner</span>
            <span>Collections</span>
            <span>Craft Value</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
