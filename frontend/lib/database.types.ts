// alfred — Supabase schema types.
//
// Shape mirrors `supabase gen types typescript`. Regenerate after any migration:
//   npx supabase gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
// Hand-authored to match database/migrations/0001_initial_schema.sql until the
// first generation against the live DB. (eslint-ignored as generated output.)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      folders: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      items: {
        Row: {
          id: string;
          title: string;
          notes: string | null;
          source_url: string | null;
          item_type: Database['public']['Enums']['item_type'];
          created_at: string;
          raw_capture: string | null;
          due_date: string | null;
          status: Database['public']['Enums']['item_status'];
          completed_at: string | null;
          folder_id: string | null;
          parent_id: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          notes?: string | null;
          source_url?: string | null;
          item_type?: Database['public']['Enums']['item_type'];
          created_at?: string;
          raw_capture?: string | null;
          due_date?: string | null;
          status?: Database['public']['Enums']['item_status'];
          completed_at?: string | null;
          folder_id?: string | null;
          parent_id?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          notes?: string | null;
          source_url?: string | null;
          item_type?: Database['public']['Enums']['item_type'];
          created_at?: string;
          raw_capture?: string | null;
          due_date?: string | null;
          status?: Database['public']['Enums']['item_status'];
          completed_at?: string | null;
          folder_id?: string | null;
          parent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'items_folder_id_fkey';
            columns: ['folder_id'];
            isOneToOne: false;
            referencedRelation: 'folders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'items_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_subtree: {
        Args: { root_id: string };
        Returns: {
          id: string;
          title: string;
          notes: string | null;
          source_url: string | null;
          item_type: Database['public']['Enums']['item_type'];
          created_at: string;
          raw_capture: string | null;
          due_date: string | null;
          status: Database['public']['Enums']['item_status'];
          completed_at: string | null;
          folder_id: string | null;
          parent_id: string | null;
          depth: number;
        }[];
      };
      complete_subtree: {
        Args: { root_id: string };
        Returns: Database['public']['Tables']['items']['Row'][];
      };
    };
    Enums: {
      item_type: 'unclassified' | 'task' | 'code' | 'knowledge';
      item_status: 'active' | 'completed';
    };
    CompositeTypes: Record<string, never>;
  };
};
