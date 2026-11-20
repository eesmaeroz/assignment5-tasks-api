# Meryem Esma Eröz, 2200005798
# Bonus 17: the API in a container, the database on a volume (/data).
#   docker build -t tasks-api .
#   docker volume create tasksdata
#   docker run -d --rm --name tasks -p 8000:8000 -v tasksdata:/data -e JWT_SECRET tasks-api
FROM denoland/deno:2.6.3
WORKDIR /app

# 1) The dependencies first, in a layer of their own: it is rebuilt only when deno.json
#    or deno.lock change, so a change in src/ does not download anything again.
COPY deno.json deno.lock ./
RUN deno install

# 2) Then the code and the migrations (Bonus 1); the server runs them at start.
COPY src ./src
COPY drizzle ./drizzle
RUN deno cache --unstable-kv --unstable-cron src/main.ts

# 3) Not as root: the user "deno" of the base image may write only to /data.
RUN mkdir /data && chown deno:deno /data
USER deno

# Everything the server keeps is under /data, which is the volume.
# APP_ENV=production: config.ts then refuses to start without a real JWT_SECRET, which is
# given at "docker run" (-e JWT_SECRET) and is never in the image.
ENV APP_ENV=production \
    PORT=8000 \
    DATABASE_URL=file:/data/tasks.db \
    KV_PATH=/data/kv.sqlite \
    UPLOAD_DIR=/data/uploads
EXPOSE 8000

# Each flag is explained in the README (Bonus 17). They are as narrow as the app allows.
CMD ["run", \
     "--unstable-kv", "--unstable-cron", \
     "--allow-net=0.0.0.0:8000", \
     "--allow-env", \
     "--allow-read=/app,/data,/deno-dir", \
     "--allow-write=/data", \
     "--allow-ffi=/deno-dir", \
     "--allow-sys=cpus,networkInterfaces,hostname", \
     "src/main.ts"]
