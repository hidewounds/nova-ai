"use strict";

/**
 * Repository abstraction layer for database operations.
 * Provides a clean interface that can be implemented for SQLite or PostgreSQL.
 */

const db = require("./connection");

class BaseRepository {
    constructor(tableName, primaryKey = "id") {
        this.tableName = tableName;
        this.primaryKey = primaryKey;
        this.db = db;
    }

    /** Execute a query and return all results. */
    async all(sql, params = []) {
        return this.db().prepare(sql).all(...params);
    }

    /** Execute a query and return the first result. */
    async get(sql, params = []) {
        return this.db().prepare(sql).get(...params);
    }

    /** Execute a query and return the first result or throw. */
    async getOrThrow(sql, params = [], errorMessage = "Record not found") {
        const row = this.db().prepare(sql).get(...params);
        if (!row) throw new Error(errorMessage);
        return row;
    }

    /** Execute a query and return the count. */
    async count(sql, params = []) {
        const row = this.db().prepare(sql).get(...params);
        return row?.count ?? 0;
    }

    /** Execute an insert and return the new row ID. */
    async insert(data) {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map(() => "?").join(", ");
        const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
        const result = this.db().prepare(sql).run(...values);
        return result.lastInsertRowid;
    }

    /** Execute an update and return the number of changes. */
    async update(whereClause, whereParams, data) {
        const keys = Object.keys(data);
        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = [...Object.values(data), ...whereParams];
        const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE ${whereClause}`;
        const result = this.db().prepare(sql).run(...values);
        return result.changes;
    }

    /** Execute a delete and return the number of changes. */
    async delete(whereClause, whereParams) {
        const sql = `DELETE FROM ${this.tableName} WHERE ${whereClause}`;
        const result = this.db().prepare(sql).run(...whereParams);
        return result.changes;
    }

    /** Check if a record exists. */
    async exists(whereClause, whereParams) {
        const sql = `SELECT 1 FROM ${this.tableName} WHERE ${whereClause} LIMIT 1`;
        const row = this.db().prepare(sql).get(...whereParams);
        return !!row;
    }

    /** Find by primary key. */
    async findById(id) {
        return this.get(`SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ?`, [id]);
    }

    /** Find by a unique field. */
    async findBy(field, value) {
        return this.get(`SELECT * FROM ${this.tableName} WHERE ${field} = ?`, [value]);
    }

    /** Find all matching records with pagination. */
    async findAll(options = {}) {
        const { where = "", whereParams = [], orderBy = "", limit = 50, offset = 0 } = options;
        let sql = `SELECT * FROM ${this.tableName}`;
        const params = [];
        if (where) {
            sql += ` WHERE ${where}`;
            params.push(...whereParams);
        }
        if (orderBy) sql += ` ORDER BY ${orderBy}`;
        sql += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        return this.all(sql, params);
    }

    /** Execute a raw query. */
    async query(sql, params = []) {
        return this.all(sql, params);
    }

    /** Execute within a transaction. */
    async transaction(fn) {
        return this.db().transaction(fn)();
    }
}

/** Factory for creating repositories. */
class RepositoryFactory {
    constructor() {
        this.repositories = new Map();
    }

    get(tableName, primaryKey = "id") {
        if (!this.repositories.has(tableName)) {
            this.repositories.set(tableName, new BaseRepository(tableName, primaryKey));
        }
        return this.repositories.get(tableName);
    }

    /** Register a custom repository. */
    register(tableName, repository) {
        this.repositories.set(tableName, repository);
    }
}

const repositoryFactory = new RepositoryFactory();

// Pre-configured repositories for common tables
const repositories = {
    businesses: repositoryFactory.get("businesses", "business_id"),
    businessConfigs: repositoryFactory.get("business_configs", "business_id"),
    knowledge: repositoryFactory.get("business_knowledge", "knowledge_id"),
    customers: repositoryFactory.get("customers", "customer_id"),
    memories: repositoryFactory.get("memories", "id"),
    behavioralEvents: repositoryFactory.get("behavioral_events", "id"),
    conversations: repositoryFactory.get("conversations", "conversation_id"),
    conversationMessages: repositoryFactory.get("conversation_messages", "id"),
    adminUsers: repositoryFactory.get("admin_users", "id"),
    adminBusinessAccess: repositoryFactory.get("admin_business_access", "id"),
    auditLog: repositoryFactory.get("audit_log", "id"),
    bookings: repositoryFactory.get("bookings", "booking_uid"),
    capabilityIntents: repositoryFactory.get("capability_intents", "id"),
    outcomeEvents: repositoryFactory.get("outcome_events", "id"),
    followUpJobs: repositoryFactory.get("follow_up_jobs", "job_uid"),
    emailLog: repositoryFactory.get("email_log", "id"),
    portalUsers: repositoryFactory.get("portal_users", "portal_uid"),
    portalSettings: repositoryFactory.get("portal_settings", "business_id"),
    featureFlags: repositoryFactory.get("feature_flags", "business_id"),
    businessAddons: repositoryFactory.get("business_addons", "business_id"),
    chronoSchedules: repositoryFactory.get("chrono_schedules", "business_id"),
    chronoOverrides: repositoryFactory.get("chrono_overrides", "id"),
    chronoSlotHolds: repositoryFactory.get("chrono_slot_holds", "id"),
    echoTranscripts: repositoryFactory.get("echo_transcripts", "transcript_id"),
    echoVoiceCalls: repositoryFactory.get("echo_voice_calls", "call_id"),
    knowledgeEmbeddings: repositoryFactory.get("knowledge_embeddings", "id"),
    webhookDeliveries: repositoryFactory.get("webhook_deliveries", "id"),
    meta: repositoryFactory.get("meta", "key"),
    schemaMigrations: repositoryFactory.get("schema_migrations", "name"),
};

module.exports = {
    BaseRepository,
    RepositoryFactory,
    repositoryFactory,
    repositories,
};