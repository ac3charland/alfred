export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      classification_corrections: {
        Row: {
          captured_text: string
          chosen_value: string | null
          created_at: string
          direction: string
          field: string
          guessed_value: string | null
          id: string
          item_id: string | null
          model: string
          prompt_version: number
          provider: string
        }
        Insert: {
          captured_text: string
          chosen_value?: string | null
          created_at?: string
          direction: string
          field: string
          guessed_value?: string | null
          id?: string
          item_id?: string | null
          model: string
          prompt_version: number
          provider: string
        }
        Update: {
          captured_text?: string
          chosen_value?: string | null
          created_at?: string
          direction?: string
          field?: string
          guessed_value?: string | null
          id?: string
          item_id?: string | null
          model?: string
          prompt_version?: number
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_corrections_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_corrections_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      code_items: {
        Row: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
          updated_at: string
        }
        Insert: {
          blocked_from?:
            | Database["public"]["Enums"]["code_factory_state"]
            | null
          blocked_reason?: string | null
          created_at?: string
          done_at?: string | null
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
          requires_refinement?: boolean
          spec_markdown?: string | null
          spec_path?: string | null
          spec_sha?: string | null
          updated_at?: string
        }
        Update: {
          blocked_from?:
            | Database["public"]["Enums"]["code_factory_state"]
            | null
          blocked_reason?: string | null
          created_at?: string
          done_at?: string | null
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
          requires_refinement?: boolean
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
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
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
          refinement_pr_url?: string | null
          spec_markdown?: string | null
          spec_path?: string | null
          spec_sha?: string | null
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
          refinement_pr_url?: string | null
          spec_markdown?: string | null
          spec_path?: string | null
          spec_sha?: string | null
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
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      habit_entries: {
        Row: {
          created_at: string
          entry_date: string
          habit_id: string
          id: string
          note: string | null
          results: Json | null
          status: Database["public"]["Enums"]["habit_day_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          habit_id: string
          id?: string
          note?: string | null
          results?: Json | null
          status: Database["public"]["Enums"]["habit_day_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          habit_id?: string
          id?: string
          note?: string | null
          results?: Json | null
          status?: Database["public"]["Enums"]["habit_day_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_entries_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          active_days: number[]
          allowance: number
          archived_at: string | null
          created_at: string
          criteria: Json
          id: string
          name: string
          notes: string | null
          sort_order: number | null
          started_on: string
        }
        Insert: {
          active_days?: number[]
          allowance?: number
          archived_at?: string | null
          created_at?: string
          criteria: Json
          id?: string
          name: string
          notes?: string | null
          sort_order?: number | null
          started_on?: string
        }
        Update: {
          active_days?: number[]
          allowance?: number
          archived_at?: string | null
          created_at?: string
          criteria?: Json
          id?: string
          name?: string
          notes?: string | null
          sort_order?: number | null
          started_on?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          classified_at: string | null
          classified_guess: Json | null
          classified_model: string | null
          classified_prompt_version: number | null
          classified_provider: string | null
          classify_attempts: number
          completed_at: string | null
          created_at: string
          dispatched_at: string | null
          due_date: string | null
          folder_id: string | null
          id: string
          intended_epic_id: string | null
          intended_project_id: string | null
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          sort_order: number
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          weekly_plan_id: string | null
        }
        Insert: {
          classified_at?: string | null
          classified_guess?: Json | null
          classified_model?: string | null
          classified_prompt_version?: number | null
          classified_provider?: string | null
          classify_attempts?: number
          completed_at?: string | null
          created_at?: string
          dispatched_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string
          intended_epic_id?: string | null
          intended_project_id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          sort_order?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          weekly_plan_id?: string | null
        }
        Update: {
          classified_at?: string | null
          classified_guess?: Json | null
          classified_model?: string | null
          classified_prompt_version?: number | null
          classified_provider?: string | null
          classify_attempts?: number
          completed_at?: string | null
          created_at?: string
          dispatched_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string
          intended_epic_id?: string | null
          intended_project_id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          sort_order?: number
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          weekly_plan_id?: string | null
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
            foreignKeyName: "items_intended_epic_id_fkey"
            columns: ["intended_epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_intended_project_id_fkey"
            columns: ["intended_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          {
            foreignKeyName: "items_weekly_plan_id_fkey"
            columns: ["weekly_plan_id"]
            isOneToOne: false
            referencedRelation: "weekly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
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
          description?: string | null
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
          description?: string | null
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
      weekly_plans: {
        Row: {
          html: string
          id: string
          uploaded_at: string
        }
        Insert: {
          html: string
          id?: string
          uploaded_at?: string
        }
        Update: {
          html?: string
          id?: string
          uploaded_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      task_items: {
        Row: {
          classified_at: string | null
          classified_guess: Json | null
          classified_model: string | null
          classified_prompt_version: number | null
          classified_provider: string | null
          classify_attempts: number | null
          completed_at: string | null
          created_at: string | null
          dispatched_at: string | null
          due_date: string | null
          folder_id: string | null
          id: string | null
          intended_epic_id: string | null
          intended_project_id: string | null
          item_type: Database["public"]["Enums"]["item_type"] | null
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          sort_order: number | null
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"] | null
          title: string | null
          weekly_plan_id: string | null
        }
        Insert: {
          classified_at?: string | null
          classified_guess?: Json | null
          classified_model?: string | null
          classified_prompt_version?: number | null
          classified_provider?: string | null
          classify_attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          dispatched_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string | null
          intended_epic_id?: string | null
          intended_project_id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"] | null
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          sort_order?: number | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"] | null
          title?: string | null
          weekly_plan_id?: string | null
        }
        Update: {
          classified_at?: string | null
          classified_guess?: Json | null
          classified_model?: string | null
          classified_prompt_version?: number | null
          classified_provider?: string | null
          classify_attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          dispatched_at?: string | null
          due_date?: string | null
          folder_id?: string | null
          id?: string | null
          intended_epic_id?: string | null
          intended_project_id?: string | null
          item_type?: Database["public"]["Enums"]["item_type"] | null
          notes?: string | null
          occurrence_index?: number | null
          parent_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          raw_capture?: string | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          sort_order?: number | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["item_status"] | null
          title?: string | null
          weekly_plan_id?: string | null
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
            foreignKeyName: "items_intended_epic_id_fkey"
            columns: ["intended_epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_intended_project_id_fkey"
            columns: ["intended_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          {
            foreignKeyName: "items_weekly_plan_id_fkey"
            columns: ["weekly_plan_id"]
            isOneToOne: false
            referencedRelation: "weekly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      v_code_stories: {
        Row: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          code_created_at: string | null
          code_updated_at: string | null
          epic_archived_at: string | null
          epic_id: string | null
          epic_name: string | null
          epic_ref: string | null
          epic_spec_path: string | null
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
          requires_refinement: boolean | null
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
          classified_at: string | null
          classified_guess: Json | null
          classified_model: string | null
          classified_prompt_version: number | null
          classified_provider: string | null
          classify_attempts: number
          completed_at: string | null
          created_at: string
          dispatched_at: string | null
          due_date: string | null
          folder_id: string | null
          id: string
          intended_epic_id: string | null
          intended_project_id: string | null
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          sort_order: number
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          weekly_plan_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      convert_to_code_epic: {
        Args: { p_item: string; p_project: string }
        Returns: Json
      }
      create_code_story: {
        Args: {
          p_epic: string
          p_notes?: string
          p_project: string
          p_requires_refinement?: boolean
          p_title: string
        }
        Returns: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
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
          refinement_pr_url: string | null
          spec_markdown: string | null
          spec_path: string | null
          spec_sha: string | null
        }
        SetofOptions: {
          from: "*"
          to: "epics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_weekly_plan_items: {
        Args: { p_items: Json; p_plan: string }
        Returns: {
          classified_at: string | null
          classified_guess: Json | null
          classified_model: string | null
          classified_prompt_version: number | null
          classified_provider: string | null
          classify_attempts: number
          completed_at: string | null
          created_at: string
          dispatched_at: string | null
          due_date: string | null
          folder_id: string | null
          id: string
          intended_epic_id: string | null
          intended_project_id: string | null
          item_type: Database["public"]["Enums"]["item_type"]
          notes: string | null
          occurrence_index: number | null
          parent_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          raw_capture: string | null
          recurrence: Json | null
          recurrence_series_id: string | null
          sort_order: number
          source_url: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          weekly_plan_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enter_code_module: {
        Args: { p_epic: string; p_item: string; p_project: string }
        Returns: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
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
      move_code_priority: {
        Args: { p_ref: string; p_to_top: boolean }
        Returns: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
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
      move_code_priority_in_project: {
        Args: { p_ref: string; p_to_top: boolean }
        Returns: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
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
      next_code_ref: { Args: { p_project: string }; Returns: number }
      swap_code_priority: {
        Args: { p_a: string; p_b: string }
        Returns: {
          blocked_from: Database["public"]["Enums"]["code_factory_state"] | null
          blocked_reason: string | null
          created_at: string
          done_at: string | null
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
          requires_refinement: boolean
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
      top_of_project_priority: { Args: { p_project: string }; Returns: number }
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
      habit_day_status: "met" | "partial" | "missed" | "skipped"
      item_status: "active" | "completed"
      item_type: "unclassified" | "task" | "code" | "knowledge"
      task_priority: "high" | "medium" | "low"
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
      habit_day_status: ["met", "partial", "missed", "skipped"],
      item_status: ["active", "completed"],
      item_type: ["unclassified", "task", "code", "knowledge"],
      task_priority: ["high", "medium", "low"],
    },
  },
} as const
