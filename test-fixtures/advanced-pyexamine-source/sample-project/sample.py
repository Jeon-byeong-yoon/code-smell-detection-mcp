def long_function(user_id, email, name):
    total = 0
    for index in range(20):
        if index % 2 == 0:
            total += index
        else:
            total -= index
    profile = {
        "user_id": user_id,
        "email": email,
        "name": name,
    }
    return total, profile


def another_long_function(user_id, email, name):
    values = []
    for index in range(20):
        values.append({
            "user_id": user_id,
            "email": email,
            "name": name,
            "index": index,
        })
    return values
