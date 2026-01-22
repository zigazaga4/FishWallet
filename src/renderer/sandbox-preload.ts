// Sandbox Preload - Bundles common frontend packages for the iframe sandbox
// These packages are exposed as window globals for use in user code
// Guided by the Holy Spirit

// React (already loaded via CDN, but we re-export for consistency)
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

// Icons
import * as LucideReact from 'lucide-react';

// Animation
import * as FramerMotion from 'framer-motion';

// UI Components
import * as HeadlessUI from '@headlessui/react';

// Utilities
import clsx from 'clsx';
import * as dateFns from 'date-fns';
import * as uuid from 'uuid';

// State Management
import * as zustand from 'zustand';

// HTTP
import axios from 'axios';

// Validation
import * as zod from 'zod';

// Notifications
import * as reactHotToast from 'react-hot-toast';

// 3D Graphics
import * as THREE from 'three';

// Extend window interface
declare global {
  interface Window {
    React: typeof React;
    ReactDOM: typeof ReactDOM;
    LucideReact: typeof LucideReact;
    FramerMotion: typeof FramerMotion;
    HeadlessUI: typeof HeadlessUI;
    clsx: typeof clsx;
    dateFns: typeof dateFns;
    uuid: typeof uuid;
    zustand: typeof zustand;
    axios: typeof axios;
    zod: typeof zod;
    reactHotToast: typeof reactHotToast;
    THREE: typeof THREE;
    // Convenience aliases
    motion: typeof FramerMotion.motion;
    AnimatePresence: typeof FramerMotion.AnimatePresence;
  }
}

// Expose all packages as window globals
window.React = React;
window.ReactDOM = ReactDOM;
window.LucideReact = LucideReact;
window.FramerMotion = FramerMotion;
window.HeadlessUI = HeadlessUI;
window.clsx = clsx;
window.dateFns = dateFns;
window.uuid = uuid;
window.zustand = zustand;
window.axios = axios;
window.zod = zod;
window.reactHotToast = reactHotToast;
window.THREE = THREE;

// Convenience aliases for commonly used exports
window.motion = FramerMotion.motion;
window.AnimatePresence = FramerMotion.AnimatePresence;

// Also expose React hooks directly for convenience
const {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useContext,
  useReducer,
  createContext,
  forwardRef,
  memo,
  lazy,
  Suspense,
  Fragment,
} = React;

// Log successful load
console.log('[Sandbox Preload] Packages loaded successfully:', {
  React: !!window.React,
  ReactDOM: !!window.ReactDOM,
  LucideReact: !!window.LucideReact,
  FramerMotion: !!window.FramerMotion,
  HeadlessUI: !!window.HeadlessUI,
  clsx: !!window.clsx,
  dateFns: !!window.dateFns,
  uuid: !!window.uuid,
  zustand: !!window.zustand,
  axios: !!window.axios,
  zod: !!window.zod,
  reactHotToast: !!window.reactHotToast,
  THREE: !!window.THREE,
});

export {
  React,
  ReactDOM,
  LucideReact,
  FramerMotion,
  HeadlessUI,
  clsx,
  dateFns,
  uuid,
  zustand,
  axios,
  zod,
  reactHotToast,
  THREE,
  // React hooks
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useContext,
  useReducer,
  createContext,
  forwardRef,
  memo,
  lazy,
  Suspense,
  Fragment,
};
