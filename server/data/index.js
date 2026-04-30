import { KNIFE_TYPES, GLOVE_TYPES, COLLECTION_KNIVES, COLLECTION_GLOVES } from './knives.js';
import { collectionsNew } from './collections-new.js';
import { collectionsMid } from './collections-mid.js';
import { collectionsOld1 } from './collections-old1.js';
import { collectionsOld2 } from './collections-old2.js';
import { collectionsClassic } from './collections-classic.js';

const allCollections = [
  ...collectionsNew,
  ...collectionsMid,
  ...collectionsOld1,
  ...collectionsOld2,
  ...collectionsClassic
];

export const collections = allCollections.map(col => ({
  ...col,
  knife: COLLECTION_KNIVES[col.id] || null,
  glove: COLLECTION_GLOVES[col.id] || null
}));

export { KNIFE_TYPES, GLOVE_TYPES, COLLECTION_KNIVES, COLLECTION_GLOVES };
