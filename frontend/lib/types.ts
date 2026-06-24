// alfred — convenience aliases over the generated Supabase schema types.
import type { Database } from '@/lib/database.types';

export type ItemType = Database['public']['Enums']['item_type'];
export type ItemStatus = Database['public']['Enums']['item_status'];
export type ItemPriority = Database['public']['Enums']['task_priority'];

export type Item = Database['public']['Tables']['items']['Row'];
export type ItemInsert = Database['public']['Tables']['items']['Insert'];
export type ItemUpdate = Database['public']['Tables']['items']['Update'];

export type Folder = Database['public']['Tables']['folders']['Row'];
export type FolderInsert = Database['public']['Tables']['folders']['Insert'];
export type FolderUpdate = Database['public']['Tables']['folders']['Update'];

// ── Software Factory (the `code` item type) — Project / Epic / Story model. ──

export type CodeFactoryState = Database['public']['Enums']['code_factory_state'];
export type CodeLane = Database['public']['Enums']['code_lane'];

export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export type Epic = Database['public']['Tables']['epics']['Row'];
export type EpicInsert = Database['public']['Tables']['epics']['Insert'];
export type EpicUpdate = Database['public']['Tables']['epics']['Update'];

export type CodeItem = Database['public']['Tables']['code_items']['Row'];
export type CodeItemInsert = Database['public']['Tables']['code_items']['Insert'];
export type CodeItemUpdate = Database['public']['Tables']['code_items']['Update'];

/** The flattened board read shape: a code story joined to its item, project, epic. */
export type CodeStory = Database['public']['Views']['v_code_stories']['Row'];

/** A row returned by the `get_subtree` RPC: an item plus its depth in the tree. */
export type SubtreeRow = Database['public']['Functions']['get_subtree']['Returns'][number];
