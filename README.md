# MindMap

This project aims to provide a way of constructing a mind map / knowledge web. The goal is to make it so low friction that it can be used in real time during a conversation by multiple people at once to, essentially, take notes. A key goal is to be able to visualize the full mind map even if it becomes huge (via resizing/rearranging all other nodes around the node(s) pinned by user) so that the relevant nodes can be readable without entirely losing sight of the whole.



# Plan

1. Infrastructure
2. Add/edit/remove nodes/edges
3. Persistence
4. Multiplayer
5. Searchability



# Development

To run the app:
```
pnpm install
turbo run dev
```

To run storybook:
```
cd apps/mind-map-sv  
pnpm run storybook
```

To push to chromatic:
```
cd apps/mind-map-sv
pnpm run chromatic
```

To run the app in docker:
```
cd apps/mind-map-sv
docker compose up
```

---

# TODO:
```
TODO: delete this todo section from the readme

TODO: delete auto gen code I no longer use (so it doesn't distract)

TODO: write story tests as stuff like "Test: Make node primary"
	tests double as list of what software does

Testability:
Load data (test once)
Logic on data (test each mutation function without needing to retest save/load)
Save data to DB (test once)

Remind myself what open badges is (or ask Nate)
PostGresql (ask AI about this vs MySql)
Redis (in memory cache. probably enough to know)
```