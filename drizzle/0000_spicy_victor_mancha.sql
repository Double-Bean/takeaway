CREATE TABLE `lunch_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lunch_usage` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
