import { create } from "zustand";

interface FavoritesState {
  favorites: Set<string>;
  addFavorite: (addr: string) => void;
  removeFavorite: (addr: string) => void;
  isFavorite: (addr: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: new Set<string>(),
  addFavorite: (addr) =>
    set((state) => {
      const next = new Set(state.favorites);
      next.add(addr);
      return { favorites: next };
    }),
  removeFavorite: (addr) =>
    set((state) => {
      const next = new Set(state.favorites);
      next.delete(addr);
      return { favorites: next };
    }),
  isFavorite: (addr) => get().favorites.has(addr),
}));