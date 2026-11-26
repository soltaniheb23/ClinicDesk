# ClinicDesk data model

```mermaid
erDiagram
    USER ||--o{ TICKET : creates
    USER ||--o{ TICKET : "is assigned"
    TICKET ||--o{ COMMENT : has
    USER ||--o{ COMMENT : writes
    TICKET ||--o{ ATTACHMENT : has
    USER ||--o{ AUDIT_LOG : performs

    USER {
        ObjectId _id PK
        string name
        string email UK
        string passwordHash
        string role "customer, agent, admin"
        boolean isActive
        date createdAt
        date updatedAt
    }
    TICKET {
        ObjectId _id PK
        string title
        string description
        string category "it, facility, account, other"
        string priority "low, normal, high, urgent"
        string status "open, in_progress, waiting, resolved, closed"
        ObjectId createdBy FK
        ObjectId assignee FK
        date firstResponseAt
        date resolvedAt
        date slaFirstResponseDueAt "CD-22, new tickets only"
        date slaResolutionDueAt "CD-22, new tickets only"
        date createdAt
        date updatedAt
    }
    COMMENT {
        ObjectId _id PK
        ObjectId ticket FK
        ObjectId author FK
        string body
        boolean internal
        date createdAt
        date updatedAt
    }
    ATTACHMENT {
        ObjectId _id PK
        ObjectId ticket FK
        ObjectId uploadedBy FK
        string originalName
        string storedName
        string mimeType
        number sizeBytes
        date createdAt
    }
    AUDIT_LOG {
        ObjectId _id PK
        ObjectId actor FK
        string action
        string entityType
        ObjectId entityId
        object metadata
        date createdAt
    }
```

## Rules
- `passwordHash` is never returned by the API.
- Audit logs are append-only.
- Status changes follow the transition table in the API contract.
- Internal comments are never returned to customers (see `docs/comments.md`).