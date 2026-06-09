// alfred — convenience aliases over the generated Supabase schema types.
import type { Database } from '@/lib/database.types';

export type ItemType = Database['public']['Enums']['item_type'];
export type ItemStatus = Database['public']['Enums']['item_status'];

export type Item = Database['public']['Tables']['items']['Row'];
export type ItemInsert = Database['public']['Tables']['items']['Insert'];
export type ItemUpdate = Database['public']['Tables']['items']['Update'];

export type Folder = Database['public']['Tables']['folders']['Row'];
export type FolderInsert = Database['public']['Tables']['folders']['Insert'];
export type FolderUpdate = Database['public']['Tables']['folders']['Update'];

/** A row returned by the `get_subtree` RPC: an item plus its depth in the tree. */
export type SubtreeRow = Database['public']['Functions']['get_subtree']['Returns'][number];
