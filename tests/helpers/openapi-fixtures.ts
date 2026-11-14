const jsonResponse = (schema: unknown) => ({ description: "ok", content: { "application/json": { schema } } });
const petRef = { $ref: "#/components/schemas/Pet" };

/** Une spécification qui couvre les cas courants : tags, $ref, allOf, références circulaires, sécurité, bodies. */
export const petstore = () => ({
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.2.0", description: "Démo" },
  servers: [{ url: "https://{env}.exemple.com/v1/", variables: { env: { default: "api" } } }, { url: "https://staging.exemple.com" }],
  tags: [{ name: "pets", description: "Animaux" }, { name: "admin" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        summary: "Santé",
        security: [],
        responses: {
          "200": jsonResponse({
            type: "object",
            properties: { status: { type: "string", enum: ["ok"] } },
            required: ["status"],
          }),
        },
      },
    },
    "/pets": {
      parameters: [{ name: "X-Trace", in: "header", required: true, schema: { type: "string" }, example: "t-1" }],
      get: {
        tags: ["pets"],
        operationId: "listPets",
        summary: "Lister",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "Accept", in: "header", schema: { type: "string" } },
          { name: "session", in: "cookie", schema: { type: "string" } },
        ],
        responses: { "200": jsonResponse({ type: "array", items: petRef }), "401": { description: "non autorisé" } },
      },
      post: {
        tags: ["pets"],
        summary: "Créer",
        requestBody: { $ref: "#/components/requestBodies/NewPetBody" },
        responses: { "201": jsonResponse(petRef) },
      },
    },
    "/pets/{petId}": {
      parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" }, example: 7 }],
      get: { tags: ["pets"], summary: "Détail", responses: { "200": jsonResponse(petRef) } },
      delete: {
        tags: ["pets", "admin"],
        security: [{ apiKeyAuth: [] }],
        responses: { "204": { description: "supprimé" } },
      },
    },
    "/orders/{orderId}": { get: { tags: ["admin"], responses: { "200": { description: "ok" } } } },
    "/secure/cookie": { get: { tags: ["admin"], summary: "Avec cookie", security: [{ cookieAuth: [] }], responses: { "200": { description: "ok" } } } },
    "/secure/oauth": { get: { tags: ["admin"], summary: "Avec OAuth", security: [{ oauth: [] }], responses: { "200": { description: "ok" } } } },
    "/login": {
      post: {
        security: [],
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: { type: "object", properties: { user: { type: "string", example: "emma" }, pass: { type: "string" } } },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/upload": {
      post: {
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: { type: "object", properties: { title: { type: "string", example: "t" }, file: { type: "string", format: "binary" } } },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/legacy": {
      get: {
        summary: "Ancien",
        responses: {
          "200": jsonResponse({ type: "object" }),
          "201": jsonResponse({ type: "array", items: { type: "string" } }),
          "2XX": { description: "joker" },
        },
      },
      trace: { responses: {} },
    },
    "/search": {
      get: {
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { default: { description: "x" } },
      },
    },
    "/people": {
      post: {
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Person" } } } },
        responses: { "200": { description: "ok" } },
      },
    },
    "/samples": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  count: { type: "integer", minimum: 5 },
                  ratio: { type: "number" },
                  active: { type: "boolean" },
                  when: { type: "string", format: "date-time" },
                  email: { type: "string", format: "email" },
                  id: { type: "string", format: "uuid" },
                  kind: { type: "string", enum: ["a", "b"] },
                  tags: { type: "array", items: { type: "integer" } },
                  nested: { type: "object", properties: { x: { type: "string", default: "dx" } } },
                  either: { oneOf: [{ type: "string", example: "first" }, { type: "integer" }] },
                  secret: { type: "string", readOnly: true },
                  nothing: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/xml": {
      post: {
        requestBody: {
          content: {
            "application/xml": {
              schema: { type: "object", properties: { name: { type: "string", example: "A" }, count: { type: "integer" } } },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/vnd": {
      post: {
        requestBody: {
          content: { "application/vnd.api+json": { schema: { type: "object", properties: { data: { type: "string" } } } } },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
  components: {
    parameters: { Limit: { name: "limit", in: "query", required: false, schema: { type: "integer", default: 20 } } },
    requestBodies: { NewPetBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewPet" } } } } },
    schemas: {
      NewPet: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string", example: "Rex" }, tag: { type: "string", nullable: true } },
      },
      Pet: {
        allOf: [
          { $ref: "#/components/schemas/NewPet" },
          {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "integer", readOnly: true },
              status: { type: "string", enum: ["available", "sold"] },
              born: { type: "string", format: "date-time" },
              owner: { $ref: "#/components/schemas/Person" },
            },
          },
        ],
      },
      Person: {
        type: "object",
        properties: { name: { type: "string" }, friends: { type: "array", items: { $ref: "#/components/schemas/Person" } } },
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "sid" },
      oauth: { type: "oauth2", flows: {} },
    },
  },
});