import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Hotel Search API",
      version: "1.0.0",
      description: "API for hotel search, user management, and chat messaging",
    },
    servers: [{ url: "/", description: "Current server" }],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: "apiKey",
          in: "cookie",
          name: "connect.sid",
          description: "Session cookie (set via POST /login)",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "integer" },
            username: { type: "string" },
            displayName: { type: "string" },
            role: { type: "string", enum: ["admin", "user"] },
            features: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        ChatMessage: {
          type: "object",
          properties: {
            id: { type: "integer" },
            text: { type: "string" },
            type: { type: "string", enum: ["issue", "feedback", "question"] },
            timestamp: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["open", "resolved"] },
            resolvedAt: { type: "string", format: "date-time" },
          },
        },
        SearchResult: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            snippet: { type: "string" },
          },
        },
      },
    },
  },
  apis: ["./routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
