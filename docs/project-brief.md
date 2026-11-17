# Tez Tagam Project Brief

## Goal

Provide a food delivery website where a customer can select menu items, submit a delivery order, and follow its progress. Restaurant staff need a simple order board to see new orders and update preparation and delivery status.

## Main customer flow

1. Browse restaurants and dishes, or search and filter the menu.
2. Add dishes to a basket and review the amount due.
3. Enter a name, phone number, and delivery address.
4. Place a cash-on-delivery order and receive an order ID.
5. Track the order using its ID as the restaurant updates progress.

## Restaurant flow

1. Open the restaurant portal and review active orders.
2. Start preparing an order, mark it ready, then mark it on the way and delivered.
3. Cancel an order when it cannot be fulfilled.

## Implemented acceptance criteria

- Menu data and prices are served from the application backend.
- Basket quantity and amount update as items are added or removed.
- The server validates menu item IDs and quantities and calculates the total from its menu data.
- A placed order and its items/status history are stored in PostgreSQL with timestamps.
- A customer can retrieve an order by its order ID.
- Restaurant staff can read orders and update their status from the order board.

## Current scope limits

The restaurant workspace is a project demo and does not require sign-in. Customer and courier sessions use signed tokens. Checkout records cash-on-delivery orders only. It does not process payments, notify real couriers, or integrate with real restaurant inventory. Add authentication to the restaurant workspace before using the staff portal beyond the class demonstration.
