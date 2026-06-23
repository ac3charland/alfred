export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      code_items: {
        Row: {
          blocked_reason: string | null
          created_at: string
          epic_id: string
          factory_state: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url: string | null
          item_id: string
          lane: Database["public"]["Enums"]["code_lane"]
          priority: number
          project_id: string
          ref: string
          ref_number: number
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          created_at?: string
          epic_id: string
          factory_state?: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url?: string | null
          item_id: string
          lane?: Database["public"]["Enums"]["code_lane"]
          priority?: number
          project_id: string
          ref: string
          ref_number: number
          refinement_pr_url?: string | null
          spec_markdown?: string | null
          spec_path?: string | null
          spec_sha?: string | null
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          created_at?: string
          epic_id?: string
          factory_state?: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url?: string | null
          item_id?: string
          lane?: Database["public"]["Enums"]["code_lane"]
          priority?: number
          project_id?: string
          ref?: string
          ref_number?: number
          refinement_pr_url?: string | null
          spec_markdown?: string | null
          spec_path?: string | null
          spec_sha?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_items_epic_id_fkey"
            columns: ["epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      epics: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          project_id: string
          ref: string
          ref_number: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          project_id: string
          ref: string
          ref_number: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          ref?: string
          ref_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "epics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          folder_id: string | null
          id: string
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          folder_id?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["item_type"]
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          folder_id?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["item_type"]
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          github_url: string | null
          id: string
          key: string
          name: string
          ref_seq: number
          repo_name: string
          repo_owner: string
        }
        Insert: {
          created_at?: string
          github_url?: string | null
          id?: string
          key: string
          name: string
          ref_seq?: number
          repo_name: string
          repo_owner: string
        }
        Update: {
          created_at?: string
          github_url?: string | null
          id?: string
          key?: string
          name?: string
          ref_seq?: number
          repo_name?: string
          repo_owner?: string
        }
        Relationships: []
      }
    }
    Views: {
      task_items: {
        Row: {
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          folder_id: string | null
          id: string | null
          item_type: Database["public"]["Enums"]["item_type"] | null
          notes: string | null
          parent_id: string | null
          raw_capture: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"] | null
          title: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"] | null
          notes?: string | null
          parent_id?: string | null
          raw_capture?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"] | null
          title?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"] | null
          notes?: string | null
          parent_id?: string | null
          raw_capture?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"] | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      v_code_stories: {
        Row: {
          blocked_reason: string | null
          code_created_at: string | null
          code_updated_at: string | null
          epic_archived_at: string | null
          epic_id: string | null
          epic_name: string | null
          epic_ref: string | null
          factory_state:
            | Database["public"]["Enums"]["code_factory_state"]
            | null
          implementation_pr_url: string | null
          item_created_at: string | null
          item_id: string | null
          lane: Database["public"]["Enums"]["code_lane"] | null
          notes: string | null
          priority: number | null
          project_id: string | null
          project_key: string | null
          project_name: string | null
          ref: string | null
          ref_number: number | null
          refinement_pr_url: string | null
          repo_name: string | null
          repo_owner: string | null
          source_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_items_epic_id_fkey"
            columns: ["epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      complete_and_spawn: {
        Args: { next_due: string; next_index: number; root_id: string }
        Returns: Json
      }
      complete_subtree: {
        Args: { root_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          folder_id: string | null
          id: string
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_code_story: {
        Args: {
          p_epic: string
          p_notes?: string
          p_project: string
          p_title: string
        }
        Returns: {
          blocked_reason: string | null
          created_at: string
          epic_id: string
          factory_state: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url: string | null
          item_id: string
          lane: Database["public"]["Enums"]["code_lane"]
          priority: number
          project_id: string
          ref: string
          ref_number: number
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "code_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_epic: {
        Args: { p_name: string; p_project: string }
        Returns: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          project_id: string
          ref: string
          ref_number: number
        }
        SetofOptions: {
          from: "*"
          to: "epics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enter_code_module: {
        Args: { p_epic: string; p_item: string; p_project: string }
        Returns: {
          blocked_reason: string | null
          created_at: string
          epic_id: string
          factory_state: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url: string | null
          item_id: string
          lane: Database["public"]["Enums"]["code_lane"]
          priority: number
          project_id: string
          ref: string
          ref_number: number
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "code_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_subtree: {
        Args: { root_id: string }
        Returns: {
          completed_at: string
          created_at: string
          depth: number
          due_date: string
          folder_id: string
          id: string
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string
          occurrence_index: number
          parent_id: string
          raw_capture: string
          recurrence: Json
          recurrence_series_id: string
          source_url: string
          status: Database["public"]["Enums"]["item_status"]
          title: string
        }[]
      }
      next_code_ref: { Args: { p_project: string }; Returns: number }
      swap_code_priority: {
        Args: { p_a: string; p_b: string }
        Returns: {
          blocked_reason: string | null
          created_at: string
          epic_id: string
          factory_state: Database["public"]["Enums"]["code_factory_state"]
          implementation_pr_url: string | null
          item_id: string
          lane: Database["public"]["Enums"]["code_lane"]
          priority: number
          project_id: string
          ref: string
          ref_number: number
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "code_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      code_factory_state:
        | "needs_refinement"
        | "in_refinement"
        | "ready_for_dev"
        | "in_development"
        | "ready_for_review"
        | "done"
        | "blocked"
        | "abandoned"
      code_lane: "human" | "local"
      item_status: "active" | "completed"
      item_type: "unclassified" | "task" | "code" | "knowledge"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      code_factory_state: [
        "needs_refinement",
        "in_refinement",
        "ready_for_dev",
        "in_development",
        "ready_for_review",
        "done",
        "blocked",
        "abandoned",
      ],
      code_lane: ["human", "local"],
      item_status: ["active", "completed"],
      item_type: ["unclassified", "task", "code", "knowledge"],
    },
  },
} as const

