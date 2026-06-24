import { DOMParser } from "@b-fuze/deno-dom";
import { AtpAgent, RichText } from "@atproto/api";
import { setInterval } from "node:timers";

type Outbox = {
  id: string;
  next: string;
  prev: string;
  orderedItems: OrderedItems<ItemType>[] | undefined;
  partOf: string;
};

type OrderedItems<ItemType> = ItemType extends "Create"
  ? { type: ItemType; object: ItemObject }
  : { type: ItemType; object: null };

type ItemType =
  | "Create"
  | "Delete"
  | "Like"
  | "Announce"
  | "Update"
  | "Undo"
  | "Flag"
  | "QuoteRequest";

type ItemObject = {
  id: string;
  inReplyTo: string | undefined;
  published: string;
  url: string;
  content?: string;
  attachment?: Attachment[] | undefined;
};

type Attachment = {
  mediaType: string;
  url: string;
  width: number;
  height: number;
};

type Config = {
  instance: string;
  username: string;
  lastSyncedPost: string;
};

async function checkNewPostThenPost(config: Config) {
  const response = await fetch(
    `${config.instance}/users/${config.username}/outbox?min_id=${config.lastSyncedPost}&page=true`,
  );

  const outbox: Outbox = await response.json();

  if (typeof outbox.orderedItems === "undefined") {
    return;
  }

  const items = outbox.orderedItems.filter((
    item,
  ): item is OrderedItems<"Create"> =>
    item != null &&
    item.type === "Create" &&
    (item.object.inReplyTo?.includes(
      `${config.instance}/users/${config.username}`,
    ) || !item.object.inReplyTo)
  ).reverse();

  items.forEach(async (item) => {
    const postTextPreProcess: string = new DOMParser().parseFromString(
      item.object.content
        ? item.object.content
          .replaceAll("</p>", "</p>\n").replaceAll("<br", "\n<br")
        : "",
      "text/html",
    ).documentElement?.innerText ?? "";
    const postTextFull: string =
      postTextPreProcess.length + item.object.url.length > 290
        ? `${
          postTextPreProcess.substring(0, 290 - item.object.url.length)
        }……\n${item.object.url}`
        : `${postTextPreProcess}\n${item.object.url}`;
    await tweet(postTextFull, item.object.published);
    console.log(postTextFull);
  });

  const lastSyncedPost: string =
    items.at(-1)?.object.id.split("/").at(-1)?.toString() ??
      config.lastSyncedPost;

  await Deno.writeTextFile(
    "config.json",
    JSON.stringify({ ...config, lastSyncedPost: lastSyncedPost }, null, 2),
  );
}

async function getConfig(): Promise<Config> {
  const ftch = await fetch(
    new URL("./config.json", import.meta.url).toString(),
  );
  const config = JSON.parse(await ftch.text());
  return config;
}

async function tweet(t: string, d: string, i?: object) {
  const service = Deno.env.get("BSKY_SERVICE");
  const identifier = Deno.env.get("BSKY_IDENTIFIER");
  const password = Deno.env.get("BSKY_PASSWORD");

  if (
    typeof service === "string" && typeof identifier === "string" &&
    typeof password === "string"
  ) {
    const agent = new AtpAgent({
      service: service,
    });
    await agent.login({
      identifier: identifier,
      password: password,
    });
    const rt = new RichText({
      text: t,
    });
    await rt.detectFacets(agent);
    await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: d || new Date().toISOString(),
    });
  }
}

setInterval(async () => {
  await checkNewPostThenPost(await getConfig());
  console.log((await getConfig()).lastSyncedPost);
}, 60000);
