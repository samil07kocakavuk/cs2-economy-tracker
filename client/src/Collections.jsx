import { useState, useEffect, useRef } from 'react';

const RARITY_COLORS = {
  "Covert": "#eb4b4b",
  "Classified": "#d32ce6",
  "Restricted": "#8847ff",
  "Mil-Spec": "#4b69ff",
  "Industrial Grade": "#5e98d9",
  "Consumer Grade": "#b0c3d9",
  "Extraordinary": "#e4ae39"
};

function getCollectionIcon(id) {
  return `https://cdn.cs2economy.com/img/catalog/collection/lg/${id}.webp`;
}

function SkinImage({ weapon, skin, className }) {
  const [src, setSrc] = useState('');
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const name = skin === 'Default' || skin === 'Vanilla'
      ? weapon : `${weapon} | ${skin} (Factory New)`;
    fetch(`/api/steam-image?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => { if (d.image) setSrc(d.image); })
      .catch(() => {});
  }, [weapon, skin]);

  if (!src) return <div className={`item-img-placeholder ${className || ''}`} />;
  return <img className={className} src={src} alt={`${weapon} | ${skin}`} loading="lazy" />;
}

export default function Collections() {
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/collections').then(r => r.json()).then(d => { setCollections(d); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    fetch(`/api/collections/${selected}`).then(r => r.json()).then(setDetail);
  }, [selected]);

  const filtered = collections.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="col-loading">Yukleniyor...</div>;

  if (!selected) return (
    <div className="col-page">
      <div className="col-hero">
        <h1>Collections</h1>
        <p>CS2 item koleksiyonlarini kesfet. Silahlar, bicaklar, eldivenler — hepsi burada.</p>
        <input className="col-search" placeholder="Koleksiyon ara..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="col-grid">
        {filtered.map(col => (
          <div key={col.id} className="col-card" onClick={() => setSelected(col.id)}>
            <div className="col-card-img">
              <img src={getCollectionIcon(col.id)} alt={col.name} loading="lazy" onError={e => { e.target.style.display='none'; }} />
            </div>
            <div className="col-card-body">
              <h3>{col.name}</h3>
              <div className="col-card-stats">
                <span>{col.itemCount} items</span>
                <span>{col.containers > 0 ? `${col.containers} container` : 'No containers'}</span>
              </div>
              <div className="col-card-row">
                <span className="col-label">Price range</span>
                <span className="col-value">{col.priceRange}</span>
              </div>
              <div className="col-card-row">
                <span className="col-label">Released</span>
                <span className="col-value">{col.released}</span>
              </div>
              {(col.knife || col.glove) && (
                <div className="col-card-specials">
                  {col.knife && <span className="col-knife-tag">★ {col.knife}</span>}
                  {col.glove && <span className="col-glove-tag">🧤 {col.glove}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="col-page">
      <button className="col-back" onClick={() => setSelected(null)}>← Collections</button>
      {!detail ? <div className="col-loading">Yukleniyor...</div> : (
        <>
          <div className="col-detail-header">
            <div className="col-detail-top">
              {detail.items[0] && <img className="col-detail-icon" src={getCollectionIcon(detail.id)} alt={detail.name} onError={e => { e.target.style.display='none'; }} />}
              <div>
                <h1>{detail.name}</h1>
                <div className="col-detail-meta">
                  <span>Released <strong>{detail.released}</strong></span>
                  <span>Price range <strong>{detail.priceRange}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {(detail.knife || detail.glove) && (
            <div className="col-specials-section">
              {detail.knife && (
                <div className="col-special-card knife">
                  <span className="col-special-icon">★</span>
                  <div>
                    <strong>{detail.knife}</strong>
                    <span>Bu koleksiyondaki bicak</span>
                  </div>
                </div>
              )}
              {detail.glove && (
                <div className="col-special-card glove">
                  <span className="col-special-icon">🧤</span>
                  <div>
                    <strong>{detail.glove}</strong>
                    <span>Bu koleksiyondaki eldiven</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <h2 className="col-section-title">Items</h2>
          <div className="col-items-grid">
            {detail.items.map((item, i) => (
              <div key={i} className="col-item-card" style={{ '--rarity-color': RARITY_COLORS[item.rarity] || '#4b69ff' }}>
                <div className="col-item-img">
                  <SkinImage weapon={item.weapon} skin={item.skin} />
                </div>
                <div className="col-item-info">
                  <span className="col-item-weapon">{item.weapon}</span>
                  <span className="col-item-skin">{item.skin}</span>
                  <span className="col-item-rarity" style={{ color: RARITY_COLORS[item.rarity] }}>{item.rarity}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
