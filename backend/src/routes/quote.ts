import { Hono } from "hono";
import { verify } from "hono/jwt";
import { JWTPayload } from "hono/utils/jwt/types";
import { getPrisma } from "prisma/prismaFunctions";

const quoteRouter = new Hono<{
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
  };
  Variables: {
    decoded: JWTPayload;
  };
}>();

// middleware
quoteRouter.use("/*", async (c, next) => {
  const token = c.req.header("Authorization")?.split(" ")[1];
  if (!token) {
    return c.json(
      {
        status: false,
        message: "No token provided",
      },
      401,
    );
  }
  try {
    const decoded = await verify(token, c.env.JWT_SECRET);
    c.set("decoded", decoded);
    await next();
  } catch (error) {
    return c.json({
      status: false,
      message: "invalid token",
    });
  }
});

type QuoteInput = {
  text: string;
  tags: string[];
};
quoteRouter.post("/", async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const authorId = String(c.get("decoded").authorId);
  const { text, tags }: QuoteInput = await c.req.json();
  try {
    const existingTags = await prisma.tag.findMany({
      where: {
        name: {
          in: tags,
        },
      },
    });
    const existingTagNames = existingTags.map((tag) => tag.name);
    const newTags = tags.filter((tag) => !existingTagNames.includes(tag));

    if (newTags.length > 0) {
      await prisma.tag.createMany({
        data: newTags.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }
    const allTags = await prisma.tag.findMany({
      where: {
        name: {
          in: tags,
        },
      },
    });

    const newQuote = await prisma.quote.create({
      data: {
        text,
        authorId,
        tags: {
          create: allTags.map((tag) => ({
            tag: {
              connect: { id: tag.id },
            },
          })),
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });
    return c.json({
      status: true,
      message: "quote submitted fr approval",
      quote: newQuote,
    });
  } catch (error) {
    return c.json({
      status: false,
      message: "failed to publish quote",
    });
  }
});
quoteRouter.get("/", async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const authorId = c.get("decoded").authorId;
  const tags = c.req.queries("tag");

  try {
    const authorQuotes = await prisma.quote.findMany({
      where: {
        authorId: String(authorId),
        tags: {
          some: {
            tag: {
              name: {
                in: tags,
              },
            },
          },
        },
      },
      include: {
        tags: {
          select: {
            tag: true,
          },
        },
      },
    });
    return c.json({
      success: true,
      quotes: authorQuotes,
    });
  } catch (error) {
    return c.json({
      success: false,
      message: "could not fetch quotes",
    });
  }
});

quoteRouter.get("/:id", async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const quoteId = c.req.param("id");

  try {
    const quote = await prisma.quote.findFirst({
      where: {
        id: quoteId,
      },
      select: {
        text: true,
        likes: true,
        tags: {
          select: {
            tag: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
    return c.json({
      success: true,
      quote: quote,
    });
  } catch (error) {
    return c.json({
      success: false,
      message: "could not fetch quote",
    });
  }
});

quoteRouter.patch("/:id/like", async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const quoteId = c.req.param("id");
  const authorId = String(c.get("decoded").authorId);

  try {
    const quote = await prisma.quote.findUnique({
      where: {
        id: quoteId,
      },
    });

    if (!quote) {
      return c.json(
        {
          success: false,
          message: "quote does not exist!",
        },
        400,
      );
    }
    if (quote.likedBy.includes(authorId)) {
      return c.json(
        { success: false, message: "You have already liked this quote" },
        400,
      );
    }
    const updatedQuote = await prisma.quote.update({
      where: { id: quoteId },
      data: {
        likes: {
          increment: 1,
        },
        likedBy: {
          push: authorId,
        },
      },
    });
    return c.json({
      success: true,
      message: "quote liked!",
      updatedQuote: updatedQuote,
    });
  } catch (error) {
    return c.json({
      success: false,
      message: "could not fetch quote",
    });
  }
});
export default quoteRouter;
