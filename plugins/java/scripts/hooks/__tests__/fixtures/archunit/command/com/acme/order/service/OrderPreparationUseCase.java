package com.acme.order.service;

import java.util.function.Consumer;

class OrderPreparationUseCase {

    public void handle(OrderPreparationCommand command) {
    }

    public void handle(Consumer<OrderPreparationCommand.Builder> command) {
        OrderPreparationCommand.Builder builder = OrderPreparationCommand.builder();
        command.accept(builder);
        handle(builder.build());
    }

}
