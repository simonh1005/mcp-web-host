import * as path from "path";
import * as fs from "fs";

import { Database } from "bun:sqlite";

export interface ToolApproval {
  id?: number;
  serverName: string;
  toolName: string;
  requiresApproval: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class DatabaseService {
  db = new Database("config/settings.db", { strict: true });

  constructor() {
    try {
      // Create tool_approvals table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS tool_approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          serverName TEXT NOT NULL,
          toolName TEXT NOT NULL,
          requiresApproval BOOLEAN NOT NULL DEFAULT 0,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(serverName, toolName)
        )
      `);

      // Create index for faster lookups
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_tool_approvals_server_tool
        ON tool_approvals(serverName, toolName)
      `);
    } catch (error: any) {
      console.warn(
        "SQLite initialization failed, falling back to JSON:",
        error?.message || error
      );
    }
  }

  // Get approval setting for a specific tool
  getToolApproval(serverName: string, toolName: string): ToolApproval | null {
    const res = this.db
      .query(
        `
          SELECT * FROM tool_approvals
          WHERE serverName = ? AND toolName = ?
        `
      )
      .get(serverName, toolName);
    return res as ToolApproval | null;
  }

  // Set approval setting for a tool
  setToolApproval(
    serverName: string,
    toolName: string,
    requiresApproval: boolean
  ): void {
    try {
      this.db
        .query(
          `
          INSERT INTO tool_approvals (
          serverName, 
          toolName, 
          requiresApproval, 
          updatedAt
          )
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(serverName, toolName) 
          DO UPDATE SET 
          requiresApproval = excluded.requiresApproval, 
          updatedAt = CURRENT_TIMESTAMP

        `
        )
        .run(serverName, toolName, requiresApproval);
    } catch (error) {
      console.error("SQLite insert failed:", error);
    }
  }

  // Get all tool approval settings
  getAllToolApprovals(): ToolApproval[] {
    return this.db
      .query("SELECT * FROM tool_approvals ORDER BY serverName, toolName")
      .all() as ToolApproval[];
  }

  // Get all tools that require approval
  getToolsRequiringApproval(): ToolApproval[] {
    return this.db
      .query(
        `
          SELECT * FROM tool_approvals
          WHERE requiresApproval = 1
          ORDER BY serverName, toolName
        `
      )
      .all() as ToolApproval[];
  }

  // Delete approval setting for a tool
  deleteToolApproval(serverName: string, toolName: string): void {
    this.db
      .query(
        `
          DELETE FROM tool_approvals
          WHERE serverName = ? AND toolName = ?
        `
      )
      .run(serverName, toolName);
  }

  // Check if a tool requires approval (returns false if not found in database)
  toolRequiresApproval(serverName: string, toolName: string): boolean {
    const approval = this.getToolApproval(serverName, toolName);
    return approval ? approval.requiresApproval : false;
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null;

export function getDatabase(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
  }
  return dbInstance;
}
