FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build:studio

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/dist/studio ./dist/studio
ENV NODE_ENV=production PORT=7860 LUNCH_PUBLIC_ORIGIN=https://jincy0610-takeaway.ms.show
USER node
EXPOSE 7860
CMD ["node", "dist/studio/server/studio/server.js"]
