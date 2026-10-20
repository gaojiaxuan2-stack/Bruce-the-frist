// Scene list, in tab order. Each scene module is only downloaded when first opened.
// `hidden` scenes get no tab and are skipped by next/prev (reachable with ?scene=<id>).
export const SCENES = [
  { id: 'face', title: 'Your Face', icon: '🙂', load: () => import('../scenes/FaceScene.js') },
  { id: 'blackhole', title: 'Black Hole', icon: '🕳️', load: () => import('../scenes/BlackHoleScene.js') },
  { id: 'galaxy', title: 'Galaxy', icon: '🌌', load: () => import('../scenes/GalaxyScene.js') },
  { id: 'mirror', title: 'Live Mirror', icon: '🪞', load: () => import('../scenes/MirrorScene.js') },
  { id: 'shapes', title: 'Shapes', icon: '💠', load: () => import('../scenes/ShapesScene.js') },
  { id: 'test', title: 'Test', icon: '·', hidden: true, load: () => import('../scenes/TestScene.js') },
];

/** Scenes that appear as tabs and in next / previous navigation. */
export const VISIBLE_SCENES = SCENES.filter((s) => !s.hidden);
