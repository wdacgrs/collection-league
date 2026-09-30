DROP INDEX `CollectionCard_profileId_idx`;--> statement-breakpoint
DROP INDEX `DeckCard_deckId_idx`;--> statement-breakpoint
DROP INDEX `Deck_profileId_idx`;--> statement-breakpoint
CREATE INDEX `Deck_profileId_createdAt_idx` ON `Deck` (`profileId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Catalog_name_nocase_idx` ON `Catalog` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `Match_createdAt_id_idx` ON `Match` (`createdAt`,`id`);