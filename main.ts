import { DOMParser } from "@b-fuze/deno-dom";
import { AppBskyEmbedImages, AtpAgent, RichText } from "@atproto/api";

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
  name?: string;
  width: number;
  height: number;
};

type Config = {
  instance: string;
  username: string;
  lastSyncedPost: string;
};

async function fetchOutbox(config: Config) {
  const response = await fetch(
    `${config.instance}/users/${config.username}/outbox?min_id=${config.lastSyncedPost}&page=true`,
  );
  return response.json();
}

async function mirrorNewPost() {
  const config = await fetchConfig();
  const outbox: Outbox = await fetchOutbox(config);

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
    const rawText: string = new DOMParser().parseFromString(
      item.object.content
        ? item.object.content
          .replaceAll("</p>", "</p>\n").replaceAll("<br", "\n<br")
        : "",
      "text/html",
    ).documentElement?.innerText ?? "";
    const postText: string = (rawText.length + item.object.url.length > 297)
      ? `${
        rawText.substring(0, 297 - item.object.url.length)
      }…\n${item.object.url}`
      : `${rawText}\n${item.object.url}`;
    const agent = await createAgent();
    const embeds = item.object.attachment
      ? await processImages(agent, item.object.attachment)
      : undefined;
    await postToBsky(agent, postText, item.object.published, embeds);
    console.log(postText);
  });

  async function processImages(agent: AtpAgent, attachments: Attachment[]) {
    const images = attachments.filter((a) => a.mediaType.includes("image"));
    let processedImages: AppBskyEmbedImages.Image[] = [];
    processedImages = await Promise.all(images.map(async (i) => {
      const fetchImage = (await fetch(i.url)).blob();
      const { data } = await agent.uploadBlob(await fetchImage, {
        encoding: i.mediaType,
      });
      return {
        alt: i.name ? i.name : "",
        image: data.blob,
        aspectRatio: { width: i.width, height: i.height },
      };
    }));
    return processedImages;
  }

  const lastSyncedPost: string =
    items.at(-1)?.object.id.split("/").at(-1)?.toString() ??
      config.lastSyncedPost;

  await Deno.writeTextFile(
    "config.json",
    JSON.stringify({ ...config, lastSyncedPost: lastSyncedPost }, null, 2),
  );
}

async function createAgent() {
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
    return agent;
  } else {
    throw new Error("Login to bsky failed");
  }
}

async function fetchConfig(): Promise<Config> {
  const fetchConfig = await fetch(
    new URL("./config.json", import.meta.url).toString(),
  );
  const config = JSON.parse(await fetchConfig.text());
  return config;
}

async function postToBsky(
  agent: AtpAgent,
  text: string,
  date: string,
  images?: AppBskyEmbedImages.Image[],
) {
  const richText = new RichText({
    text: text,
  });
  await richText.detectFacets(agent);
  await agent.post({
    text: richText.text,
    facets: richText.facets,
    createdAt: date,
    ...(images && {
      embed: {
        $type: "app.bsky.embed.images",
        images: images,
      },
    }),
  });
}

setInterval(async () => {
  await mirrorNewPost();
}, 60000);
