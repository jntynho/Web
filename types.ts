
export type ThemeMode = 'Dark' | 'Grey' | 'Amoled' | 'Blue' | 'Light';
export type DisplaySize = 'Small' | 'Medium' | 'Large';
export type AspectRatio = '16:9' | '3:2' | '5:7' | 'Adaptive';
export type SortOrder = 'Newest' | 'Oldest' | 'DateDesc' | 'DateAsc' | 'A-Z' | 'Z-A';
export type ButtonStyle = 'Glass' | 'ColorGlass' | 'SolidColors';
export type FontFamily = 'Plus Jakarta Sans' | 'Inter' | 'Outfit' | 'Manrope' | 'Poppins' | 'Sora' | 'System';

export interface Actor {
  id: string;
  stashDbId?: string;
  name: string;
  imageUrl: string;
  originalImageUrl?: string;
  availableImages?: string[];
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
  createdAt?: number;
  instagramUrl?: string;
  twitterUrl?: string;
  onlyFansUrl?: string;
}

export interface CoomerPost {
  id: string;
  stashDbId?: string;
  urls: string[];
  thumbUrls?: string[];
  caption?: string;
  mediaTypes?: ('image' | 'video')[];
  videoDurations?: number[];
  type: 'Single' | 'Multiple';
  createdAt: number;
  date?: number; // Main date for sorting (usually the date of the first image)
  perImageDates?: (number | undefined)[]; // Optional dates for each image in a Multiple post
  sourceService?: string; // e.g. 'onlyfans', 'fansly', 'patreon', 'candfans'
}

export interface Coomer {
  id: string;
  stashDbId?: string;
  name: string;
  imageUrl: string;
  originalImageUrl?: string;
  createdAt?: number;
  posts?: CoomerPost[];
  totalPostsCount?: number;
  sourceUrl?: string;
  secondarySourceUrl?: string;
  sourceUrls?: string[];
  goonboxUrl?: string;
  isFullySynced?: boolean;
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
  // Legacy / backward compatibility fields
  instagramPosts?: CoomerPost[];
  onlyFansPosts?: CoomerPost[];
  instagramSourceUrl?: string;
  onlyFansSourceUrl?: string;
  instagramLinks?: string[];
  onlyFansLinks?: string[];
}

export interface Studio {
  id: string;
  stashDbId?: string;
  name: string;
  imageUrl?: string;
  logoUrl?: string;
  logoBgColor?: string;
  originalImageUrl?: string;
  createdAt?: number;
}

export interface LinkItem {
  id: string;
  stashDbId?: string;
  title: string;
  urlHD?: string;
  url4K?: string;
  magnet?: string;
  magnet4K?: string;
  torrentUrlHD?: string;
  torrentUrl4K?: string;
  torrentSiteName?: string;
  coverImage: string;
  coverOffset?: number; 
  aspectRatio?: AspectRatio;
  galleryUrls?: string[];
  originalGalleryUrls?: string[];
  galleryDimensions?: { width: number; height: number }[];
  qualityPreference?: 'thumbnail' | 'original';
  galleryScraperUrl?: string;
  trailerUrl?: string;
  actorIds: string[];
  studioIds: string[];
  assignedDate?: number;
  createdAt?: number;
}

export interface AppSettings {
  theme: ThemeMode;
  accentColor: string;
  actorNameColor: string;
  circleBorderColor: string;
  torboxApiKey?: string;
  enableTorbox?: boolean;
  realDebridApiKey?: string;
  enableRealDebrid?: boolean;
  stashDbApiKey?: string;
  enableStashDB?: boolean;
  javstashApiKey?: string;
  enableJavstash?: boolean;
  geminiApiKey?: string;
  enableGemini?: boolean;
  autoSync?: boolean; // Enable cloud auto-sync
  titleSize: DisplaySize;
  metadataSize: DisplaySize;
  showActorCheckmark: boolean;
  enableGalleryPreview: boolean;
  enableTrailerPreview?: boolean;
  sortOrder: SortOrder;
  homeSortOrder?: SortOrder;
  actorSortOrder?: SortOrder;
  studioSortOrder?: SortOrder;
  coomerSortOrder?: SortOrder;
  hanimeSortOrder?: SortOrder;
  actorLinksSortOrder?: SortOrder;
  studioLinksSortOrder?: SortOrder;
  itemsPerPage: number;
  blurIntensity: number;
  blurCovers: boolean;
  gradientMask?: boolean;
  transparentHeader?: boolean;
  headerElementBorder?: boolean;
  headerBottomBorder?: boolean;
  buttonStyle: ButtonStyle;
  buttonColor: string;
  galleryBgColor: string;
  headerOpacity: number;
  headerTheme: ThemeMode | 'Default';
  fontFamily?: FontFamily;
  hiddenStashDbStudios?: string[];
}

export interface HanimeEpisode {
  id: string;
  stashDbId?: string;
  url: string;
  coverImage: string;
  episodeNumber: number;
  title?: string;
  description?: string;
  boosterCover?: string;
  assignedDate?: number;
  censorship?: 'UNCENSORED' | 'CENSORED';
  gallery?: string[];
}

export interface HanimeItem {
  id: string;
  stashDbId?: string;
  title: string;
  coverImage: string;
  coverOffset?: number;
  secondaryCovers?: string[];
  description?: string;
  assignedDate?: number;
  censorship?: 'UNCENSORED' | 'CENSORED';
  episodes: HanimeEpisode[];
  createdAt?: number;
}

export interface AppState {
  links: LinkItem[];
  hanime: HanimeItem[];
  actors: Actor[];
  coomers: Coomer[];
  studios: Studio[];
  settings: AppSettings;
  coomerActiveTab?: 'Instagram' | 'OnlyFans';
}
